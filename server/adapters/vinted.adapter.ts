import type { NormalizedListing } from '../core/types.js';
import { SourceError } from '../core/types.js';
import type { MarketplaceAdapter, AdapterHealth, AdapterSearchParams } from '../core/types.js';
import { VintedClient, opSearch } from '@googlarz/vinted-client';
import { PoliteClient } from './scrape.js';

export interface VintedAdapterOptions {
  id: string;
  label: string;
  markets: string[];
  icon: string;
  description: string;
  docsUrl: string;
  envVar: string;
  enabled: boolean;
  capabilities: string[];
  userAgent: string;
  minIntervalMs: number;
  country: string;
}

export class VintedAdapter implements MarketplaceAdapter {
  readonly id: string;
  readonly label: string;
  readonly mode = 'live' as const;
  readonly markets: string[];
  readonly icon: string;
  readonly auth = 'Unofficial Vinted API (vinted-client)';
  readonly envVars: string[];
  readonly capabilities: string[];
  readonly docsUrl: string;
  readonly description: string;

  private readonly opts: VintedAdapterOptions;
  private readonly client: PoliteClient;

  constructor(opts: VintedAdapterOptions) {
    this.opts = opts;
    this.id = opts.id;
    this.label = opts.label;
    this.markets = [...opts.markets];
    this.icon = opts.icon;
    this.description = opts.description;
    this.docsUrl = opts.docsUrl;
    this.capabilities = [...opts.capabilities];
    this.envVars = [opts.envVar, 'SCRAPER_MIN_INTERVAL_MS'];
    this.client = new PoliteClient({
      source: opts.label,
      userAgent: opts.userAgent,
      minIntervalMs: opts.minIntervalMs,
    });
  }

  isEnabled(): boolean { return this.opts.enabled; }
  disabledReason(): string | null { return this.opts.enabled ? null : `Disabled via ${this.opts.envVar}=false`; }

  async search({ q, limit, market }: AdapterSearchParams): Promise<NormalizedListing[]> {
    if (!this.isEnabled()) throw new SourceError(`${this.label} adapter is disabled`, 'AUTH');
    await this.client.wait();
    const fetchedAt = new Date().toISOString();
    const country = (market && VINTED_COUNTRY[market]) || 'de';
    let res: { items?: unknown[]; totalCount?: number };
    try {
      const client = new VintedClient();
      res = await opSearch(client, { query: q, country: country as any, perPage: limit });
    } catch (err) {
      throw new SourceError(`${this.label} request failed: ${(err as Error).message}`, 'NETWORK');
    }
    const items = (res?.items ?? []) as unknown as Array<Record<string, unknown>>;
    return items.slice(0, limit).map((it) => {
      const id = String(it.id ?? '');
      const title = String(it.title ?? '');
      const price = it.price != null ? Number(it.price) : null;
      const currency = (it.currency as string) || 'EUR';
      const url = (it.url as string) || `https://www.vinted.com/items/${id}`;
      const image = (it.photoUrl as string) || null;
      const size = typeof it.size === 'string' ? it.size : null;
      const gender =
        typeof it.gender === 'string'
          ? it.gender.toLowerCase()
          : null;
      return {
        id: `${this.id}:${id}`,
        source: this.id,
        sourceListingId: id,
        title,
        description: '',
        price: Number.isFinite(price as number) ? price : null,
        currency,
        location: null,
        imageUrl: image,
        listingUrl: url,
        publishedAt: null,
        fetchedAt,
        gender: gender === 'male' || gender === 'female' || gender === 'unisex' ? gender : null,
        size,
      };
    });
  }

  async healthCheck(): Promise<AdapterHealth> {
    const started = Date.now();
    if (!this.isEnabled()) return { ok: false, latencyMs: 0, message: this.disabledReason() ?? 'Disabled.' };
    try {
      const client = new VintedClient();
      const res = await opSearch(client, { query: 'iphone', country: 'de', perPage: 3 });
      const n = res?.items?.length ?? 0;
      return n > 0
        ? { ok: true, latencyMs: Date.now() - started, message: `Search OK — ${n} listings.` }
        : { ok: false, latencyMs: Date.now() - started, message: 'No listings returned.' };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, message: err instanceof SourceError ? err.message : 'Health check failed.' };
    }
  }
}

// Country code -> Vinted country code mapping
const VINTED_COUNTRY: Record<string, string> = {
  DE: 'de', FR: 'fr', IT: 'it', ES: 'es', NL: 'nl', BE: 'be',
  GB: 'uk', PL: 'pl', AT: 'at', CZ: 'cz', SK: 'sk', HU: 'hu',
  RO: 'ro', LT: 'lt', HR: 'hr', SE: 'se', PT: 'pt', LU: 'lu',
  FI: 'fi', DK: 'dk',
};




export function createVintedAdapter(cfg: { userAgent: string; minIntervalMs: number; vinted: boolean }): VintedAdapter {
  return new VintedAdapter({
    id: 'vinted',
    label: 'Vinted',
    markets: Object.keys(VINTED_COUNTRY),
    icon: 'apparel',
    description: 'Vinted via unofficial vinted-client (Node). Terms prohibit scraping - disabled by default.',
    docsUrl: 'https://www.vinted.com',
    envVar: 'ENABLE_VINTED_ADAPTER',
    enabled: cfg.vinted,
    capabilities: ['Unofficial API', 'Multi-country'],
    userAgent: cfg.userAgent,
    minIntervalMs: cfg.minIntervalMs,
    country: 'de',
  });
}
