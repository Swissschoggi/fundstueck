import type {
  AdapterHealth,
  AdapterSearchParams,
  MarketplaceAdapter,
  NormalizedListing,
} from '../core/types.js';
import { SourceError } from '../core/types.js';
import {
  asArray,
  asRecord,
  extractNextData,
  parseChfPrice,
  PoliteClient,
  str,
  type JsonObject,
  type PoliteClientOptions,
} from './scrape.js';

type Json = JsonObject;

/** Find the edges of the `SearchListingsByConstraints` query in Next.js props. */
function findListingNodes(nextData: unknown): Json[] {
  const pageProps = asRecord(asRecord(asRecord(nextData)?.props)?.pageProps);
  const queries = asArray(asRecord(pageProps?.['dehydratedState'])?.['queries']);
  const query = queries
    .map(asRecord)
    .find((q) => asArray(q?.['queryKey'])[0] === 'SearchListingsByConstraints');
  if (!query) {
    if (queries.length > 0) {
      throw new SourceError(
        'SMG page structure changed: SearchListingsByConstraints query not found.',
        'RESPONSE',
      );
    }
    return [];
  }

  const listings = asRecord(asRecord(asRecord(query['state'])?.['data'])?.['listings']);
  return asArray(listings?.['edges'])
    .map((edge) => asRecord(asRecord(edge)?.['node']))
    .filter((node): node is Json => node != null);
}

export interface SmgAdapterOptions {
  /** "tutti" | "anibis" — both run the same SMG Next.js platform. */
  id: string;
  label: string;
  locale: 'de' | 'fr';
  /** Search page base, e.g. https://www.tutti.ch/de/q */
  searchBaseUrl: string;
  /** Site origin, e.g. https://www.tutti.ch */
  siteBaseUrl: string;
  icon: string;
  description: string;
  docsUrl: string;
  envVar: string;
  enabled: boolean;
  capabilities: string[];
  /** Build an absolute listing URL from a parsed node. */
  listingUrl: (node: Json, id: string) => string;
  userAgent: string;
  minIntervalMs: number;
  timeoutMs?: number;
}

/**
 * Shared adapter for the SMG marketplaces (Tutti.ch, Anibis.ch).
 *
 * Reads the public, server-rendered search page only (`/q?query=…`) and
 * normalises the embedded Next.js JSON. It never calls `/api/…`, never logs
 * in, never solves or bypasses a CAPTCHA, and rate-limits + caches requests.
 */
export class SmgAdapter implements MarketplaceAdapter {
  readonly id: string;
  readonly label: string;
  readonly mode = 'live' as const;
  readonly markets = ['CH'];
  readonly icon: string;
  readonly auth = 'Public search page · no key';
  readonly envVars: string[];
  readonly capabilities: string[];
  readonly docsUrl: string;
  readonly description: string;

  private readonly client: PoliteClient;

  constructor(private readonly opts: SmgAdapterOptions) {
    this.id = opts.id;
    this.label = opts.label;
    this.icon = opts.icon;
    this.description = opts.description;
    this.docsUrl = opts.docsUrl;
    this.capabilities = opts.capabilities;
    this.envVars = [opts.envVar, 'SCRAPER_MIN_INTERVAL_MS', 'SCRAPER_USER_AGENT'];
    const clientOpts: PoliteClientOptions = {
      source: opts.label,
      userAgent: opts.userAgent,
      minIntervalMs: opts.minIntervalMs,
      timeoutMs: opts.timeoutMs ?? 6500,
      acceptLanguage:
        opts.locale === 'fr'
          ? 'fr-CH,fr;q=0.9,de;q=0.6,en;q=0.5'
          : 'de-CH,de;q=0.9,fr;q=0.6,en;q=0.5',
    };
    this.client = new PoliteClient(clientOpts);
  }

  isEnabled(): boolean {
    return this.opts.enabled;
  }

  disabledReason(): string | null {
    return this.opts.enabled ? null : `Disabled via ${this.opts.envVar}=false`;
  }

  async search({ q, limit, signal }: AdapterSearchParams): Promise<NormalizedListing[]> {
    if (!this.opts.enabled) {
      throw new SourceError(`${this.label} adapter is disabled`, 'AUTH');
    }
    const html = await this.client.getHtml(this.searchUrl(q), { signal });
    return this.parse(html).slice(0, limit);
  }

  async healthCheck(): Promise<AdapterHealth> {
    const started = Date.now();
    if (!this.opts.enabled) {
      return { ok: false, latencyMs: 0, message: this.disabledReason() ?? 'Disabled.' };
    }
    try {
      // Fresh (uncached) fetch so the probe really validates reachability.
      const html = await this.client.getHtml(this.searchUrl('velo'), { fresh: true });
      const listings = this.parse(html);
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

  private searchUrl(query: string): string {
    const url = new URL(this.opts.searchBaseUrl);
    url.searchParams.set('query', query);
    return url.toString();
  }

  private parse(html: string): NormalizedListing[] {
    const nodes = findListingNodes(extractNextData(html, this.label));
    const fetchedAt = new Date().toISOString();
    return nodes
      .map((node) => this.normalize(node, fetchedAt))
      .filter((listing): listing is NormalizedListing => listing != null);
  }

  private normalize(node: Json, fetchedAt: string): NormalizedListing | null {
    const rawId = node['listingID'];
    const id = typeof rawId === 'string' ? rawId : typeof rawId === 'number' ? String(rawId) : '';
    const localization = asRecord(node['localization']);
    const title = str(localization?.['title']);
    if (!id || !title) return null;

    const postcodeInfo = asRecord(node['postcodeInformation']);
    const locationName = str(postcodeInfo?.['locationName']);
    const postcode = str(postcodeInfo?.['postcode']);
    const location = [locationName, postcode].filter(Boolean).join(' ') || null;

    const thumbnail = asRecord(node['thumbnail']);
    const imageUrl =
      str(asRecord(thumbnail?.['retinaRendition'])?.['src']) ??
      str(asRecord(thumbnail?.['normalRendition'])?.['src']) ??
      null;

    return {
      id: `${this.id}:${id}`,
      source: this.id,
      sourceListingId: id,
      title,
      description: str(localization?.['body']) ?? '',
      price: parseChfPrice(str(node['formattedPrice'])),
      currency: 'CHF',
      location,
      imageUrl,
      listingUrl: this.opts.listingUrl(node, id),
      publishedAt: str(node['timestamp']) ?? null,
      fetchedAt,
    };
  }
}

/** Build https://www.tutti.ch/{locale}/vi/{slug}/{id} from a listing node. */
export function smgListingUrl(
  siteBaseUrl: string,
  locale: 'de' | 'fr',
  node: Json,
  id: string,
): string {
  const seo = asRecord(node['seoInformation']);
  const slug = str(seo?.[`${locale}Slug`]);
  return slug
    ? `${siteBaseUrl}/${locale}/vi/${slug}/${id}`
    : `${siteBaseUrl}/${locale}/vi/${id}`;
}
