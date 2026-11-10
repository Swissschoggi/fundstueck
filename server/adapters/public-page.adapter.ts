import type {
  AdapterHealth,
  AdapterSearchParams,
  MarketplaceAdapter,
  NormalizedListing,
} from '../core/types.js';
import { SourceError } from '../core/types.js';
import { PoliteClient } from './scrape.js';

/**
 * Shared base for marketplaces that server-render their public search page.
 * Subclasses provide the URL builder and a parser; this class handles polite
 * fetching, caching, health checks, enable/disable state and the shared shape.
 */
export interface PublicPageAdapterOptions {
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
  timeoutMs?: number;
  searchUrl: (query: string) => string;
  parse: (html: string, fetchedAt: string) => NormalizedListing[];
}

export class PublicPageAdapter implements MarketplaceAdapter {
  readonly id: string;
  readonly label: string;
  readonly mode = 'live' as const;
  readonly markets: string[];
  readonly icon: string;
  readonly description: string;
  readonly auth = 'Public search page · no key';
  readonly envVars: string[];
  readonly capabilities: string[];
  readonly docsUrl: string;

  private readonly opts: PublicPageAdapterOptions;
  private readonly client: PoliteClient;

  constructor(opts: PublicPageAdapterOptions) {
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
      timeoutMs: opts.timeoutMs ?? 6500,
      acceptLanguage: opts.acceptLanguage,
    });
  }

  isEnabled(): boolean {
    return this.opts.enabled;
  }

  disabledReason(): string | null {
    return this.opts.enabled ? null : `Disabled via ${this.opts.envVar}=false`;
  }

  async search({ q, limit }: AdapterSearchParams): Promise<NormalizedListing[]> {
    if (!this.opts.enabled) {
      throw new SourceError(`${this.label} adapter is disabled`, 'AUTH');
    }
    const html = await this.client.getHtml(this.opts.searchUrl(q));
    return this.opts.parse(html, new Date().toISOString()).slice(0, limit);
  }

  async healthCheck(): Promise<AdapterHealth> {
    const started = Date.now();
    if (!this.opts.enabled) {
      return { ok: false, latencyMs: 0, message: this.disabledReason() ?? 'Disabled.' };
    }
    try {
      const html = await this.client.getHtml(this.opts.searchUrl('velo'), { fresh: true });
      const listings = this.opts.parse(html, new Date().toISOString());
      const latencyMs = Date.now() - started;
      return listings.length > 0
        ? {
            ok: true,
            latencyMs,
            message: `Search page reachable — ${listings.length} listings parsed.`,
          }
        : {
            ok: false,
            latencyMs,
            message: 'Search page reachable but contained no listings.',
          };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: err instanceof SourceError ? err.message : 'Health check failed.',
      };
    }
  }
}
