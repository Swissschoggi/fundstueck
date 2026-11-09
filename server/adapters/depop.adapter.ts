import type { NormalizedListing } from '../core/types.js';
import { SourceError } from '../core/types.js';
import { execFile } from 'node:child_process';
import { getAdapterConfig } from '../core/adapter-config.js';
import { promisify } from 'node:util';
import type { MarketplaceAdapter, AdapterHealth, AdapterSearchParams } from '../core/types.js';

const execFileAsync = promisify(execFile);

const SITE = 'https://www.depop.com';

export interface DepopAdapterOptions {
  id: string;
  label: string;
  markets: string[];
  icon: string;
  description: string;
  docsUrl: string;
  envVar: string;
  enabled: boolean;
  capabilities: string[];
  acceptLanguage: string;
  userAgent: string;
  minIntervalMs: number;
}

export class DepopAdapter implements MarketplaceAdapter {
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
      key: 'country',
      label: 'Country override (US/GB/AU, optional)',
      placeholder: 'US',
      help: 'Force a Depop market. Leave empty to use IP detection.',
    },
    {
      key: 'flaresolverr_url',
      label: 'FlareSolverr URL (optional, bypasses Cloudflare)',
      placeholder: 'http://localhost:8191',
      help:
        'If set, fetches Depop through FlareSolverr to solve Cloudflare challenges. ' +
        'Requires a running FlareSolverr instance (e.g. docker run -p 8191:8191 flaresolverr/flaresolverr).',
    },
  ];

  private readonly opts: DepopAdapterOptions;
  private lastRequestAt = 0;
  private readonly cache = new Map<string, { at: number; html: string }>();
  private readonly cacheTtlMs = 60_000;

  constructor(opts: DepopAdapterOptions) {
    this.opts = opts;
    this.id = opts.id;
    this.label = opts.label;
    this.markets = [...opts.markets];
    this.icon = opts.icon;
    this.description = opts.description;
    this.docsUrl = opts.docsUrl;
    this.capabilities = [...opts.capabilities];
    this.envVars = [opts.envVar, 'SCRAPER_MIN_INTERVAL_MS', 'SCRAPER_USER_AGENT'];
  }

  isEnabled(): boolean {
    return this.opts.enabled;
  }

  disabledReason(): string | null {
    return this.opts.enabled ? null : `Disabled via ${this.opts.envVar}=false`;
  }

  private async waitTurn(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(
      0,
      this.lastRequestAt + this.opts.minIntervalMs + Math.random() * 750 - now,
    );
    this.lastRequestAt = now + wait;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  private flaresolverrUrl(): string | null {
    const cfg = getAdapterConfig(this.id);
    const fromCfg = (cfg.flaresolverr_url ?? '').trim();
    if (fromCfg) return fromCfg.replace(/\/+$/, '');
    const fromEnv = (process.env.FLARESOLVERR_URL ?? '').trim();
    return fromEnv ? fromEnv.replace(/\/+$/, '') : null;
  }

  private async fetchViaFlaresolverr(url: string): Promise<string> {
    const base = this.flaresolverrUrl();
    if (!base) throw new SourceError('FlareSolverr not configured', 'AUTH');
    let stdout: string;
    try {
      const res = await fetch(`${base}/v1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd: 'request.get', url }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as { status?: string; solution?: { response?: string; status?: number } };
      if (data.status !== 'ok' || !data.solution?.response) {
        throw new Error(data.status ?? 'no solution');
      }
      stdout = data.solution.response;
    } catch (err) {
      throw new SourceError(
        `${this.label} FlareSolverr request failed: ${(err as Error).message}`,
        'NETWORK',
      );
    }
    if (!stdout || /Just a moment|challenge-platform/i.test(stdout) && !/objects/i.test(stdout)) {
      throw new SourceError(`${this.label} returned a CAPTCHA/interstitial page`, 'UPSTREAM');
    }
    return stdout;
  }

  private async getHtml(url: string, fresh = false): Promise<string> {
    const cached = this.cache.get(url);
    if (!fresh && cached && Date.now() - cached.at < this.cacheTtlMs) {
      return cached.html;
    }
    await this.waitTurn();
    let stdout: string;
    if (this.flaresolverrUrl()) {
      stdout = await this.fetchViaFlaresolverr(url);
    } else {
      const args = [
        '-sS',
        '-L',
        '--max-time',
        '15',
        '-H',
        `User-Agent: ${this.opts.userAgent}`,
        '-H',
        'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        '-H',
        `Accept-Language: ${this.opts.acceptLanguage}`,
        url,
      ];
      try {
        const result = await execFileAsync('curl', args, { maxBuffer: 10 * 1024 * 1024 });
        stdout = result.stdout;
      } catch (err) {
        throw new SourceError(
          `${this.label} request failed: ${(err as Error).message}`,
          'NETWORK',
        );
      }
      if (!stdout || /Just a moment|challenge-platform/i.test(stdout)) {
        throw new SourceError(`${this.label} returned a CAPTCHA/interstitial page`, 'UPSTREAM');
      }
    }
    this.cache.set(url, { at: Date.now(), html: stdout });
    return stdout;
  }

  async search({ q, limit }: AdapterSearchParams): Promise<NormalizedListing[]> {
    if (!this.opts.enabled) {
      throw new SourceError(`${this.label} adapter is disabled`, 'AUTH');
    }
    const url = `${SITE}/search/?q=${encodeURIComponent(q)}`;
    const html = await this.getHtml(url);
    const fetchedAt = new Date().toISOString();
    return parseObjects(html, this.id, fetchedAt).slice(0, limit);
  }

  async healthCheck(): Promise<AdapterHealth> {
    const started = Date.now();
    if (!this.opts.enabled) {
      return { ok: false, latencyMs: 0, message: this.disabledReason() ?? 'Disabled.' };
    }
    try {
      const html = await this.getHtml(`${SITE}/search/?q=nike`, true);
      const listings = parseObjects(html, this.id, new Date().toISOString());
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

interface DepopObject {
  id?: number;
  slug?: string;
  description?: string;
  pictures?: Array<{ formats?: Record<string, { url?: string }> }>;
  preview?: { formats?: Record<string, { url?: string }> };
  location?: string;
  pricing?: { currency?: string; current_price?: { total_price?: string } };
}

function parseObjects(html: string, source: string, fetchedAt: string): NormalizedListing[] {
  const out: NormalizedListing[] = [];
  const pushMatches = html.match(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g) ?? [];
  let payload = '';
  for (const m of pushMatches) {
    const inner = m.replace(/^self\.__next_f\.push\(\[1,"/, '').replace(/"\]\)$/, '');
    try {
      payload += JSON.parse('"' + inner + '"');
    } catch {
      payload += inner
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
  }
  const idx = payload.indexOf('"objects":[');
  if (idx === -1) return out;
  const start = payload.indexOf('[', idx);
  let depth = 0;
  let end = -1;
  for (let j = start; j < payload.length; j++) {
    const c = payload[j];
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) {
        end = j;
        break;
      }
    }
  }
  if (end === -1) return out;

  let objects: DepopObject[] = [];
  try {
    objects = JSON.parse(payload.slice(start, end + 1)) as DepopObject[];
  } catch {
    return out;
  }

  for (const o of objects) {
    const id = o.id != null ? String(o.id) : '';
    const slug = o.slug ?? '';
    const title = (o.description ?? '').trim();
    if (!id || !slug || !title) continue;

    const previewUrl =
      (o.preview?.formats?.['P0']?.url as string | undefined) ??
      (Array.isArray(o.pictures) ? (o.pictures[0]?.formats?.['P0']?.url as string | undefined) : undefined) ??
      null;

    const currency = (o.pricing?.currency ?? 'USD').toUpperCase();
    const priceRaw = o.pricing?.current_price?.total_price;
    const price = priceRaw != null ? Number(priceRaw) : null;

    out.push({
      id: `${source}:${id}`,
      source,
      sourceListingId: id,
      title,
      description: '',
      price: Number.isFinite(price as number) ? price : null,
      currency,
      location: o.location ?? null,
      imageUrl: previewUrl,
      listingUrl: `${SITE}/products/${slug}/`,
      publishedAt: null,
      fetchedAt,
    });
  }
  return out;
}

export function createDepopAdapter(cfg: {
  userAgent: string;
  minIntervalMs: number;
  depop: boolean;
}): DepopAdapter {
  return new DepopAdapter({
    id: 'depop',
    label: 'Depop',
    markets: ['CH', 'US', 'GB', 'DE', 'AT', 'FR', 'IT', 'ES', 'NL', 'BE', 'CA', 'AU'],
    icon: 'apparel',
    description:
      'Reads the public, server-rendered Depop search page and normalises the embedded ' +
      'Next.js product data. Rate-limited and cached; no /api/ calls, no login, no ' +
      'CAPTCHA solving. Note: Depop robots.txt disallows /search/* for crawlers and ' +
      'Depop terms prohibit scraping — disabled by default; enable explicitly with ' +
      'ENABLE_DEPOP_ADAPTER=true after reviewing their terms.',
    docsUrl: `${SITE}/search/?q=nike`,
    envVar: 'ENABLE_DEPOP_ADAPTER',
    enabled: cfg.depop,
    capabilities: [
      'Public web search',
      'Server-rendered JSON',
      'Rate-limited + cached',
      'Multi-currency',
    ],
    acceptLanguage: 'en-GB,en;q=0.9',
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    minIntervalMs: cfg.minIntervalMs,
  });
}
