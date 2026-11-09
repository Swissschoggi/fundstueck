import type { ScraperConfig } from '../config.js';
import type { NormalizedListing } from '../core/types.js';
import { SourceError } from '../core/types.js';
import { PoliteClient } from './scrape.js';
import { getAdapterConfig } from '../core/adapter-config.js';
import { decodeEntities } from './html.js';
import type { MarketplaceAdapter, AdapterHealth, AdapterSearchParams } from '../core/types.js';

const SITE = 'https://marko.ch';
// Top-level marko category IDs (fashion, electronics, home). Category pages are
// server-rendered and honour `?q=` for filtering, unlike the LiveView /search page.
const ALL_CATEGORIES = ['fashion-c01000000', 'electronics-c02000000', 'home-c03000000'];

function resolveCategories(raw: string | undefined): string[] {
  // Allow UI-stored config to override env.
  const fromConfig = getAdapterConfig('marko').categories;
  const effective = (fromConfig && fromConfig.trim()) ? fromConfig : raw;
  if (!effective || effective.trim() === '' || effective.trim().toLowerCase() === 'all') {
    return ALL_CATEGORIES;
  }
  const requested = effective.split(',').map((c) => c.trim()).filter(Boolean);
  const valid = requested.filter((c) => ALL_CATEGORIES.includes(c));
  return valid.length > 0 ? valid : ALL_CATEGORIES;
}

interface MarkoOptions {
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
  acceptLanguage: string;
  /** Comma-separated category slugs to query, or 'all' (default). */
  categories?: string;
}

export class MarkoAdapter implements MarketplaceAdapter {
  readonly id: string;
  readonly label: string;
  readonly mode = 'live' as const;
  readonly markets: string[];
  readonly icon: string;
  readonly auth = 'Public search page · no key';
  readonly envVars: string[];
  readonly capabilities: string[];
  readonly docsUrl: string;
  readonly description: string;

  readonly configFields = [
    {
      key: 'categories',
      label: 'Categories (comma-separated slugs, or "all")',
      placeholder: 'fashion-c01000000,electronics-c02000000,home-c03000000',
      default: 'all',
      help: 'Top-level marko category IDs to query. "all" queries fashion, electronics and home.',
    },
  ];

  private readonly opts: MarkoOptions;
  private readonly client: PoliteClient;

  constructor(opts: MarkoOptions) {
    this.opts = opts;
    this.id = opts.id;
    this.label = opts.label;
    this.markets = [...opts.markets];
    this.icon = opts.icon;
    this.description = opts.description;
    this.docsUrl = opts.docsUrl;
    this.capabilities = [...opts.capabilities];
    this.envVars = [opts.envVar, 'SCRAPER_MIN_INTERVAL_MS', 'SCRAPER_USER_AGENT'];
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

  async search({ q, limit, market, category }: AdapterSearchParams): Promise<NormalizedListing[]> {
    if (!this.opts.enabled) {
      throw new SourceError(`${this.label} adapter is disabled`, 'AUTH');
    }
    const fetchedAt = new Date().toISOString();
    const categories = category
      ? [category]
      : resolveCategories(this.opts.categories);
    const results: NormalizedListing[] = [];
    for (const cat of categories) {
      const url = `${SITE}/en/c/${cat}?q=${encodeURIComponent(q)}`;
      try {
        const html = await this.client.getHtml(url);
        results.push(...parseCards(html, this.id, fetchedAt));
      } catch (err) {
        // A single category failing shouldn't kill the whole search; surface
        // as a SourceError only when every category failed.
        if (results.length === 0 && cat === categories[categories.length - 1]) {
          throw err instanceof SourceError ? err : new SourceError(String(err), 'UPSTREAM');
        }
      }
      if (results.length >= limit) break;
    }
    return results.slice(0, limit);
  }

  async healthCheck(): Promise<AdapterHealth> {
    const started = Date.now();
    if (!this.opts.enabled) {
      return { ok: false, latencyMs: 0, message: this.disabledReason() ?? 'Disabled.' };
    }
    try {
      const cats = resolveCategories(this.opts.categories);
      const html = await this.client.getHtml(`${SITE}/en/c/${cats[0]}?q=velo`, { fresh: true });
      const listings = parseCards(html, this.id, new Date().toISOString());
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

function parseCards(html: string, source: string, fetchedAt: string): NormalizedListing[] {
  const out: NormalizedListing[] = [];
  const cardRe = /<div id="products-page-1-[^"]+"[\s\S]*?(?=<div id="products-page-1-|$)/g;
  let match: RegExpExecArray | null;
  while ((match = cardRe.exec(html)) !== null) {
    const block = match[0];
    const payloadM = /data-payload="([^"]*)"/.exec(block);
    const hrefM = /href="(\/en\/p\/[^"]+)"/.exec(block);
    const imgM = /<img src="(https:\/\/cdn\.marko\.ch\/[^"]+)"/.exec(block);
    if (!payloadM || !hrefM) continue;

    let item: Record<string, unknown> | null = null;
    let currency = 'CHF';
    let price: number | null = null;
    let title = '';
    try {
      const payload = JSON.parse(decodeEntities(payloadM[1]));
      const data = (payload as { data?: { items?: Array<Record<string, unknown>>; currency?: string } }).data;
      if (data?.items?.length) {
        item = data.items[0] as Record<string, unknown>;
        title = typeof item.item_name === 'string' ? item.item_name : '';
        price = typeof item.price === 'number' ? item.price : null;
        if (typeof data.currency === 'string') currency = data.currency;
      }
    } catch {
      /* fall through */
    }

    if (!title && imgM) {
      const altM = /alt="([^"]*)"/.exec(block);
      if (altM) title = decodeEntities(altM[1]);
    }
    if (!title) continue;

    const id = typeof item?.item_id === 'string' ? item.item_id : hrefM[1];
    const imageUrl = imgM ? imgM[1] : null;
    const listingUrl = new URL(hrefM[1], SITE).toString();

    out.push({
      id: `${source}:${id}`,
      source,
      sourceListingId: id,
      title,
      description: '',
      price,
      currency,
      location: null,
      imageUrl,
      listingUrl,
      publishedAt: null,
      fetchedAt,
    });
  }
  return out;
}

export function createMarkoAdapter(cfg: ScraperConfig): MarkoAdapter {
  return new MarkoAdapter({
    id: 'marko',
    label: 'Marko.ch',
    markets: ['CH'],
    icon: 'storefront',
    description:
      'Reads the public, server-rendered Marko category pages (fashion, electronics, ' +
      'home) filtered by the query and normalises the embedded listing cards. ' +
      'Rate-limited and cached; no /api/ calls, no login, no CAPTCHA solving. ' +
      'Marko is Switzerland-only (CHF).',
    docsUrl: `${SITE}/en/search`,
    envVar: 'ENABLE_MARKO_ADAPTER',
    enabled: cfg.marko,
    capabilities: [
      'Public web search',
      'Server-rendered HTML',
      'Rate-limited + cached',
      'CHF prices',
      'Swiss marketplace',
    ],
    acceptLanguage: 'de-CH,de;q=0.9,fr;q=0.8,en;q=0.7',
    userAgent: cfg.userAgent,
    minIntervalMs: cfg.minIntervalMs,
    categories: process.env.MARKO_CATEGORIES,
  });
  // configFields already declared on the class
}
