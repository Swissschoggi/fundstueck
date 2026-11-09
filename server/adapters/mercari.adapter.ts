import type { NormalizedListing } from '../core/types.js';
import { SourceError } from '../core/types.js';
import type { MarketplaceAdapter, AdapterHealth, AdapterSearchParams } from '../core/types.js';
import { Mercapi } from 'mercapi';

export interface MercariAdapterOptions {
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
}

export class MercariAdapter implements MarketplaceAdapter {
  readonly id: string;
  readonly label: string;
  readonly mode = 'live' as const;
  readonly markets: string[];
  readonly icon: string;
  readonly auth = 'Unofficial Mercari Japan API';
  readonly envVars: string[];
  readonly capabilities: string[];
  readonly docsUrl: string;
  readonly description: string;

  private readonly opts: MercariAdapterOptions;
  private lastRequestAt = 0;

  constructor(opts: MercariAdapterOptions) {
    this.opts = opts;
    this.id = opts.id;
    this.label = opts.label;
    this.markets = [...opts.markets];
    this.icon = opts.icon;
    this.description = opts.description;
    this.docsUrl = opts.docsUrl;
    this.capabilities = [...opts.capabilities];
    this.envVars = [opts.envVar, 'SCRAPER_MIN_INTERVAL_MS'];
  }

  isEnabled(): boolean { return this.opts.enabled; }
  disabledReason(): string | null { return this.opts.enabled ? null : `Disabled via ${this.opts.envVar}=false`; }

  private async waitTurn(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(0, this.lastRequestAt + this.opts.minIntervalMs - now);
    this.lastRequestAt = now + wait;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  async search({ q, limit }: AdapterSearchParams): Promise<NormalizedListing[]> {
    if (!this.isEnabled()) throw new SourceError(`${this.label} adapter is disabled`, 'AUTH');
    await this.waitTurn();
    const fetchedAt = new Date().toISOString();
    let res: { items?: unknown[] };
    try {
      res = await Mercapi.search(q, {});
    } catch (err) {
      throw new SourceError(`${this.label} request failed: ${(err as Error).message}`, 'NETWORK');
    }
    const items = (res?.items ?? []) as unknown as Array<Record<string, unknown>>;
    return items.slice(0, limit).map((it) => {
      const id = String(it.id ?? '');
      const name = String(it.name ?? '');
      const price = typeof it.price === 'number' ? it.price : null;
      const thumb = Array.isArray(it.thumbnails) ? (it.thumbnails[0] as string) : null;
      const created = typeof it.created === 'number' ? new Date(it.created * 1000).toISOString() : null;
      return {
        id: `${this.id}:${id}`,
        source: this.id,
        sourceListingId: id,
        title: name,
        description: '',
        price,
        currency: 'JPY',
        location: null,
        imageUrl: thumb,
        listingUrl: `https://jp.mercari.com/item/${id}`,
        publishedAt: created,
        fetchedAt,
        gender: null,
      };
    });
  }

  async healthCheck(): Promise<AdapterHealth> {
    const started = Date.now();
    if (!this.isEnabled()) return { ok: false, latencyMs: 0, message: this.disabledReason() ?? 'Disabled.' };
    try {
      const res = await Mercapi.search('iphone', {});
      const n = res?.items?.length ?? 0;
      return n > 0
        ? { ok: true, latencyMs: Date.now() - started, message: `Search OK — ${n} listings.` }
        : { ok: false, latencyMs: Date.now() - started, message: 'No listings returned.' };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, message: err instanceof SourceError ? err.message : 'Health check failed.' };
    }
  }
}

export function createMercariAdapter(cfg: { userAgent: string; minIntervalMs: number; mercari: boolean }): MercariAdapter {
  return new MercariAdapter({
    id: 'mercari',
    label: 'Mercari (JP)',
    markets: ['JP'],
    icon: 'shopping_bag',
    description: 'Mercari Japan via unofficial mercapi client (npm).',
    docsUrl: 'https://jp.mercari.com',
    envVar: 'ENABLE_MERCARI_ADAPTER',
    enabled: cfg.mercari,
    capabilities: ['Unofficial API', 'Multi-currency (JPY)'],
    userAgent: cfg.userAgent,
    minIntervalMs: cfg.minIntervalMs,
  });
}
