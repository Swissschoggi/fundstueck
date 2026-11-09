import type { NormalizedListing } from '../core/types.js';
import { SourceError } from '../core/types.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { MarketplaceAdapter, AdapterHealth, AdapterSearchParams } from '../core/types.js';

const execFileAsync = promisify(execFile);

export interface BlocketAdapterOptions {
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
  scriptPath: string;
}

export class BlocketAdapter implements MarketplaceAdapter {
  readonly id: string;
  readonly label: string;
  readonly mode = 'live' as const;
  readonly markets: string[];
  readonly icon: string;
  readonly auth = 'Public Blocket API (blocket-api python)';
  readonly envVars: string[];
  readonly capabilities: string[];
  readonly docsUrl: string;
  readonly description: string;

  private readonly opts: BlocketAdapterOptions;
  private lastRequestAt = 0;

  constructor(opts: BlocketAdapterOptions) {
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
    let stdout: string;
    try {
      const res = await execFileAsync('python3', [this.opts.scriptPath, q, '--max-results', String(limit)], { maxBuffer: 10 * 1024 * 1024, timeout: 60000 });
      stdout = res.stdout;
    } catch (err) {
      throw new SourceError(`${this.label} request failed: ${(err as Error).message}`, 'NETWORK');
    }
    let items: Array<Record<string, unknown>>;
    try {
      items = JSON.parse(stdout);
    } catch {
      throw new SourceError(`${this.label} returned invalid JSON`, 'UPSTREAM');
    }
    return items.map((it) => ({
      id: `${this.id}:${it.id}`,
      source: this.id,
      sourceListingId: String(it.id),
      title: String(it.title ?? ''),
      description: '',
      price: typeof it.price === 'number' ? it.price : null,
      currency: (it.currency as string) || 'SEK',
      location: (it.location as string) || null,
      imageUrl: (it.image as string) || null,
      listingUrl: (it.url as string) || '',
      publishedAt: (it.publishedAt as string) || null,
      fetchedAt,
      gender: null,
    }));
  }

  async healthCheck(): Promise<AdapterHealth> {
    const started = Date.now();
    if (!this.isEnabled()) return { ok: false, latencyMs: 0, message: this.disabledReason() ?? 'Disabled.' };
    try {
      const res = await execFileAsync('python3', [this.opts.scriptPath, 'iphone', '--max-results', '2'], { maxBuffer: 1024 * 1024, timeout: 60000 });
      const items = JSON.parse(res.stdout);
      return items.length > 0
        ? { ok: true, latencyMs: Date.now() - started, message: `Search OK — ${items.length} listings.` }
        : { ok: false, latencyMs: Date.now() - started, message: 'No listings returned.' };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, message: err instanceof SourceError ? err.message : 'Health check failed.' };
    }
  }
}

export function createBlocketAdapter(cfg: { userAgent: string; minIntervalMs: number; blocket: boolean }): BlocketAdapter {
  return new BlocketAdapter({
    id: 'blocket',
    label: 'Blocket (SE)',
    markets: ['SE'],
    icon: 'search',
    description: 'Blocket Sweden via blocket-api python library.',
    docsUrl: 'https://www.blocket.se',
    envVar: 'ENABLE_BLOCKET_ADAPTER',
    enabled: cfg.blocket,
    capabilities: ['Python blocket-api', 'Recommerce'],
    userAgent: cfg.userAgent,
    minIntervalMs: cfg.minIntervalMs,
    scriptPath: `${process.cwd()}/scripts/blocket_scraper.py`,
  });
}
