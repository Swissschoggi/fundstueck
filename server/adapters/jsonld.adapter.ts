import type { NormalizedListing } from '../core/types.js';
import { SourceError } from '../core/types.js';
import type { MarketplaceAdapter, AdapterHealth, AdapterSearchParams } from '../core/types.js';
import { PoliteClient } from './scrape.js';

export interface JsonLdAdapterOptions {
  id: string;
  label: string;
  markets: string[];
  currency: string;
  icon: string;
  description: string;
  docsUrl: string;
  envVar: string;
  enabled: boolean;
  capabilities: string[];
  acceptLanguage: string;
  userAgent: string;
  minIntervalMs: number;
  searchUrl: (q: string) => string;
  /** Optional: build a URL for a given page number (1-based). */
  searchPageUrl?: (q: string, page: number) => string;
}

export class JsonLdAdapter implements MarketplaceAdapter {
  readonly id: string;
  readonly label: string;
  readonly mode = 'live' as const;
  readonly markets: string[];
  readonly icon: string;
  readonly description: string;
  readonly auth = 'Public search page · JSON-LD';
  readonly envVars: string[];
  readonly capabilities: string[];
  readonly docsUrl: string;

  private readonly opts: JsonLdAdapterOptions;
  private readonly client: PoliteClient;

  constructor(opts: JsonLdAdapterOptions) {
    this.opts = opts;
    this.id = opts.id;
    this.label = opts.label;
    this.markets = [...opts.markets];
    this.icon = opts.icon;
    this.description = opts.description;
    this.envVars = [opts.envVar, 'SCRAPER_MIN_INTERVAL_MS', 'SCRAPER_USER_AGENT'];
    this.capabilities = [...opts.capabilities];
    this.docsUrl = opts.docsUrl;
    this.client = new PoliteClient({
      source: opts.label,
      userAgent: opts.userAgent,
      minIntervalMs: opts.minIntervalMs,
      acceptLanguage: opts.acceptLanguage,
    });
  }

  isEnabled(): boolean {
    return this.opts.enabled;
  }

  disabledReason(): string | null {
    return this.opts.enabled ? null : `Disabled via ${this.opts.envVar}=false`;
  }

  private parse(html: string, fetchedAt: string): NormalizedListing[] {
    const out: NormalizedListing[] = [];
    const scripts = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g) ?? [];
    for (const sc of scripts) {
      const inner = sc.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
      let data: unknown;
      try {
        data = JSON.parse(inner);
      } catch {
        continue;
      }
      const collect = (node: unknown) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
          for (const n of node) collect(n);
          return;
        }
        const o = node as Record<string, unknown>;
        if (o['@type'] === 'ItemList') {
          const elems = (o['itemListElement'] as unknown[]) ?? [];
          for (const el of elems) {
            const item = (el as Record<string, unknown>)?.['item'] as Record<string, unknown> | undefined;
            if (!item) continue;
            const offers = item['offers'] as Record<string, unknown> | undefined;
            const priceRaw = offers?.['price'];
            const price = priceRaw != null ? Number(priceRaw) : null;
            const currency = (offers?.['priceCurrency'] as string) || this.opts.currency;
            const name = (item['name'] as string) || (item['description'] as string) || '';
            const url = item['url'] as string | undefined;
            const image = item['image'] as string | undefined;
            if (!name || !url) continue;
            out.push({
              id: `${this.id}:${url}`,
              source: this.id,
              sourceListingId: url,
              title: name.trim(),
              description: (item['description'] as string) || '',
              price: Number.isFinite(price as number) ? price : null,
              currency,
              location: null,
              imageUrl: image ?? null,
              listingUrl: url.startsWith('http') ? url : `${this.opts.docsUrl.replace(/\/$/, '')}${url}`,
              publishedAt: null,
              fetchedAt,
              gender: null,
            });
          }
        }
        // Recurse into nested objects
        for (const v of Object.values(o)) {
          if (v && typeof v === 'object') collect(v);
        }
      };
      collect(data);
    }
    return out;
  }

  async search({ q, limit }: AdapterSearchParams): Promise<NormalizedListing[]> {
    if (!this.isEnabled()) {
      throw new SourceError(`${this.label} adapter is disabled`, 'AUTH');
    }
    const html = await this.client.getHtml(this.opts.searchUrl(q));
    return this.parse(html, new Date().toISOString()).slice(0, limit);
  }

  async searchPage({ q, limit }: AdapterSearchParams, page: number): Promise<NormalizedListing[]> {
    if (!this.isEnabled()) {
      throw new SourceError(`${this.label} adapter is disabled`, 'AUTH');
    }
    const url = this.opts.searchPageUrl
      ? this.opts.searchPageUrl(q, page)
      : this.opts.searchUrl(q);
    const html = await this.client.getHtml(url);
    return this.parse(html, new Date().toISOString()).slice(0, limit);
  }

  async healthCheck(): Promise<AdapterHealth> {
    const started = Date.now();
    if (!this.isEnabled()) {
      return { ok: false, latencyMs: 0, message: this.disabledReason() ?? 'Disabled.' };
    }
    try {
      const html = await this.client.getHtml(this.opts.searchUrl('velo'), { fresh: true });
      const listings = this.parse(html, new Date().toISOString());
      const latencyMs = Date.now() - started;
      return listings.length > 0
        ? { ok: true, latencyMs, message: `Search page reachable — ${listings.length} listings parsed.` }
        : { ok: false, latencyMs, message: 'Search page reachable but contained no listings.' };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: err instanceof SourceError ? err.message : 'Health check failed.',
      };
    }
  }
}
