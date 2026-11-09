import { SourceError } from '../core/types.js';

export type JsonObject = Record<string, unknown>;

export function asRecord(value: unknown): JsonObject | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export interface PoliteClientOptions {
  /** Adapter id, used in error messages. */
  source: string;
  userAgent: string;
  /** Minimum spacing between outbound requests from this adapter. */
  minIntervalMs: number;
  /** Extra random spacing added on top of minIntervalMs (politeness jitter). */
  jitterMs?: number;
  timeoutMs?: number;
  cacheTtlMs?: number;
  acceptLanguage?: string;
}

/**
 * Small polite HTTP client shared by the public-page adapters:
 * - serialised, rate-limited requests with jitter (never hammer a site),
 * - short-lived response cache so repeated searches share one fetch,
 * - explicit timeouts and safe SourceError messages.
 */
export class PoliteClient {
  private lastRequestAt = 0;
  private readonly cache = new Map<string, { at: number; html: string }>();
  private readonly jitterMs: number;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly acceptLanguage: string;

  constructor(private readonly opts: PoliteClientOptions) {
    this.jitterMs = opts.jitterMs ?? 750;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.cacheTtlMs = opts.cacheTtlMs ?? 60_000;
    this.acceptLanguage = opts.acceptLanguage ?? 'de-CH,de;q=0.9,fr;q=0.8,en;q=0.7';
  }

  async getHtml(url: string, options: { fresh?: boolean } = {}): Promise<string> {
    const cached = this.cache.get(url);
    if (!options.fresh && cached && Date.now() - cached.at < this.cacheTtlMs) {
      return cached.html;
    }

    await this.waitTurn();

    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'follow',
        headers: {
          'User-Agent': this.opts.userAgent,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': this.acceptLanguage,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new SourceError(
        `${this.opts.source} request failed: ${(err as Error).message}`,
        'NETWORK',
      );
    }

    if (!res.ok) {
      throw new SourceError(
        `${this.opts.source} responded with HTTP ${res.status}`,
        'UPSTREAM',
        res.status,
      );
    }

    const html = await res.text();
    this.cache.set(url, { at: Date.now(), html });
    return html;
  }

  private async waitTurn(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(
      0,
      this.lastRequestAt + this.opts.minIntervalMs + Math.random() * this.jitterMs - now,
    );
    this.lastRequestAt = now + wait;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

const NEXT_DATA_RE = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i;

/** Extract the Next.js server-rendered JSON payload embedded in a page. */
export function extractNextData(html: string, source: string): unknown {
  const match = html.match(NEXT_DATA_RE);
  if (!match) {
    if (looksLikeCaptcha(html)) {
      throw new SourceError(`${source} returned a CAPTCHA/interstitial page`, 'UPSTREAM');
    }
    throw new SourceError(`${source} page did not contain embedded search data`, 'RESPONSE');
  }
  try {
    return JSON.parse(match[1]);
  } catch {
    throw new SourceError(`${source} embedded data was not valid JSON`, 'RESPONSE');
  }
}

export function looksLikeCaptcha(html: string): boolean {
  return /<title>\s*(Ricardo Captcha|Just a moment|Attention Required)/i.test(html);
}

/**
 * Parse Swiss marketplace price strings into a number, e.g.
 * "80.-" → 80, "1'250.–" → 1250, "CHF 1'250.50" → 1250.5, "Gratis" → 0.
 * Returns null when no price is present.
 */
export function parseChfPrice(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;
  if (/gratis|verschenk|à donner|a donner|\bfree\b/i.test(text)) return 0;

  let digits = text.replace(/[^\d.,]/g, '');
  if (!digits) return null;

  if (digits.includes(',') && digits.includes('.')) {
    digits = digits.replace(/\./g, '').replace(',', '.');
  } else if (digits.includes(',')) {
    digits = digits.replace(',', '.');
  } else if ((digits.match(/\./g) ?? []).length > 1) {
    digits = digits.replace(/\./g, '');
  }

  const value = Number(digits);
  return Number.isFinite(value) ? value : null;
}

/** Extract the JSON-LD blocks from a page (used for the Ricardo fallback). */
export function extractJsonLd(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(re)) {
    try {
      blocks.push(JSON.parse(match[1]));
    } catch {
      /* ignore malformed blocks */
    }
  }
  return blocks;
}
