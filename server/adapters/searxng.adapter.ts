import type { MarketplaceAdapter, AdapterSearchParams, NormalizedListing, AdapterHealth } from '../core/types.js';
import { SourceError } from '../core/types.js';
import { combineSignals } from './scrape.js';
import { getAdapterConfig } from '../core/adapter-config.js';

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
  readonly configFields = [
    {
      key: 'base_url',
      label: 'SearXNG base URL',
      placeholder: 'http://localhost:8080',
      help: 'Self-hosted SearXNG instance with JSON output enabled.',
    },
  ];

  private readonly cfg: SearxngConfig;
  private enabled: boolean;

  constructor(cfg: SearxngConfig & { enabled?: boolean }) {
    this.cfg = { baseUrl: cfg.baseUrl, userAgent: cfg.userAgent, minIntervalMs: cfg.minIntervalMs };
    this.enabled = cfg.enabled ?? true;
  }

  private effectiveBaseUrl(): string {
    const fromConfig = (getAdapterConfig(this.id).base_url ?? '').trim();
    if (fromConfig) return fromConfig;
    return (this.cfg.baseUrl ?? '').trim();
  }

  isEnabled(): boolean { return Boolean(this.effectiveBaseUrl()); }
  disabledReason(): string | null { return this.isEnabled() ? null : 'Set a SearXNG base URL in the adapter config or SEARXNG_URL.'; }

  async search(params: AdapterSearchParams): Promise<NormalizedListing[]> {
    if (!this.isEnabled()) throw new SourceError('SearXNG disabled', 'AUTH');
    const fetchedAt = new Date().toISOString();
    const base = this.effectiveBaseUrl();
    const url = `${base.replace(/\/$/, '')}/search?q=${encodeURIComponent(params.q)}&format=json&categories=general`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': this.cfg.userAgent, Accept: 'application/json' },
        signal: combineSignals(params.signal, AbortSignal.timeout(10_000)),
      });
    } catch (err) {
      throw new SourceError(`SearXNG request failed: ${(err as Error).message}`, 'NETWORK');
    }
    if (!res.ok) throw new SourceError(`SearXNG HTTP ${res.status} (enable "json" in search.formats)`, 'UPSTREAM');
    const body = await res.json() as { results?: Array<{ title?: string; url?: string; content?: string; img_src?: string }> };
    const denied = /pinterest|facebook|instagram|reddit|wikipedia|youtube|tiktok|twitter|x\.com|blog|news|medium\.com|shutterstock|istockphoto|gettyimages|stockphoto|dreamstime|depositphotos|alamy|freepik|unsplash|pexels|pixabay/i;
    const out: NormalizedListing[] = [];
    for (const r of body.results ?? []) {
      if (!r.title || !r.url) continue;
      try {
        const host = new URL(r.url).hostname;
        if (denied.test(host) || denied.test(r.url)) continue;
      } catch { continue; }
      if (/\\b(best|top\\s*\\d|guide|review|how to|roundup|comparison)\\b/i.test(r.title)) continue;
      if (/\\b202\\d\\b/.test(r.title)) continue;
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
    if (!this.isEnabled()) return { ok: false, latencyMs: 0, message: this.disabledReason() ?? 'Disabled.' };
    try {
      const base = this.effectiveBaseUrl();
      const url = `${base.replace(/\/$/, '')}/search?q=test&format=json`;
      const res = await fetch(url, { headers: { 'User-Agent': this.cfg.userAgent } });
      return { ok: res.ok, latencyMs: Date.now() - started, message: res.ok ? 'OK' : `HTTP ${res.status} (enable "json" in search.formats)` };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, message: err instanceof Error ? err.message : 'Failed' };
    }
  }
}