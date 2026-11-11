import type { MarketplaceAdapter, AdapterSearchParams, NormalizedListing, AdapterHealth } from '../core/types.js';
import { SourceError } from '../core/types.js';
import { combineSignals } from './scrape.js';

export interface SearxngConfig {
  baseUrl: string;
  userAgent: string;
  minIntervalMs: number;
}

export class SearxngAdapter implements MarketplaceAdapter {
  readonly id = 'searxng';
  readonly label = 'SearXNG';
  readonly mode = 'live' as const;
  readonly markets = ['CH', 'US', 'GB', 'DE', 'AT', 'FR', 'IT', 'ES', 'NL', 'BE', 'CA', 'AU'];
  readonly icon = 'search';
  readonly description = 'Meta-search via a self-hosted SearXNG instance (web results, no prices).';
  readonly auth = 'Self-hosted SearXNG';
  readonly envVars = ['SEARXNG_URL', 'SCRAPER_MIN_INTERVAL_MS', 'SCRAPER_USER_AGENT'];
  readonly capabilities = ['Web meta-search', 'JSON API'];
  readonly docsUrl = 'https://docs.searxng.org';
  readonly configFields = undefined;

  private readonly cfg: SearxngConfig;
  private enabled: boolean;

  constructor(cfg: SearxngConfig & { enabled: boolean }) {
    this.cfg = { baseUrl: cfg.baseUrl, userAgent: cfg.userAgent, minIntervalMs: cfg.minIntervalMs };
    this.enabled = cfg.enabled;
  }

  isEnabled(): boolean { return this.enabled; }
  disabledReason(): string | null { return this.enabled ? null : 'Disabled via SEARXNG_URL (unset)'; }

  async search(params: AdapterSearchParams): Promise<NormalizedListing[]> {
    if (!this.enabled) throw new SourceError('SearXNG disabled', 'AUTH');
    const fetchedAt = new Date().toISOString();
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/search?q=${encodeURIComponent(params.q)}&format=json&categories=general`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': this.cfg.userAgent, Accept: 'application/json' },
        signal: combineSignals(params.signal, AbortSignal.timeout(10_000)),
      });
    } catch (err) {
      throw new SourceError(`SearXNG request failed: ${(err as Error).message}`, 'NETWORK');
    }
    if (!res.ok) throw new SourceError(`SearXNG HTTP ${res.status}`, 'UPSTREAM');
    const body = await res.json() as { results?: Array<{ title?: string; url?: string; content?: string; img_src?: string }> };
    const out: NormalizedListing[] = [];
    for (const r of body.results ?? []) {
      if (!r.title || !r.url) continue;
      out.push({
        id: `searxng-${Buffer.from(r.url).toString('base64').slice(0, 12)}`,
        source: this.id,
        sourceListingId: r.url,
        title: r.title,
        description: r.content ?? '',
        price: null,
        currency: 'CHF',
        location: null,
        imageUrl: r.img_src ?? null,
        listingUrl: r.url,
        publishedAt: null,
        fetchedAt,
      });
      if (out.length >= (params.limit ?? 20)) break;
    }
    return out;
  }

  async healthCheck(): Promise<AdapterHealth> {
    const started = Date.now();
    if (!this.enabled) return { ok: false, latencyMs: 0, message: this.disabledReason() ?? 'Disabled.' };
    try {
      const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/search?q=test&format=json`;
      const res = await fetch(url, { headers: { 'User-Agent': this.cfg.userAgent } });
      return { ok: res.ok, latencyMs: Date.now() - started, message: res.ok ? 'OK' : `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, message: err instanceof Error ? err.message : 'Failed' };
    }
  }
}