import {
  SORTS,
  SourceError,
  type MarketplaceAdapter,
  type NormalizedListing,
  type SearchResponse,
  type SortKey,
} from '../core/types.js';
import { logEvent } from './events.js';
import { DEFAULT_MARKET, findMarket, MARKETS } from './markets.js';

export interface SearchQuery {
  q: string;
  /** Buyer market the search is scoped to, e.g. "CH". */
  market: string;
  /** Optional category filter. */
  category: string | null;
  /** Optional gender filter: male/female/unisex. */
  gender: string | null;
  /** Optional size filter. */
  size: string | null;
  sort: SortKey;
  minPrice: number | null;
  maxPrice: number | null;
  limit: number;
}

export class ValidationError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function parseSearchParams(
  raw: Record<string, unknown>,
  defaultMarket = DEFAULT_MARKET,
): SearchQuery {
  const marketRaw =
    typeof raw['market'] === 'string' && raw['market'].trim()
      ? raw['market'].trim().toUpperCase()
      : defaultMarket;
  const market = findMarket(marketRaw);
  if (!market) {
    throw new ValidationError(
      `Invalid "market" value. Allowed: ${MARKETS.map((m) => m.code).join(', ')}.`,
    );
  }

  const category = typeof raw['category'] === 'string' ? raw['category'].trim() : null;
  const genderRaw = typeof raw['gender'] === 'string' ? raw['gender'].trim().toLowerCase() : '';
  const gender = ['male', 'female', 'unisex'].includes(genderRaw) ? genderRaw : null;
  const sizeRaw = typeof raw['size'] === 'string' ? raw['size'].trim() : '';
  const size = sizeRaw ? sizeRaw.toLowerCase() : null;

  const q = typeof raw['q'] === 'string' ? raw['q'].trim() : '';
  if (!q) {
    throw new ValidationError('Query parameter "q" is required and must be non-empty.');
  }
  if (q.length > 200) {
    throw new ValidationError('Query parameter "q" must be at most 200 characters.');
  }

  const sortRaw = typeof raw['sort'] === 'string' ? raw['sort'] : 'newest';
  if (!(SORTS as readonly string[]).includes(sortRaw)) {
    throw new ValidationError(`Invalid "sort" value. Allowed: ${SORTS.join(', ')}.`);
  }

  const minPrice = parsePrice(raw['minPrice'], 'minPrice');
  const maxPrice = parsePrice(raw['maxPrice'], 'maxPrice');
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    throw new ValidationError('"minPrice" must not exceed "maxPrice".');
  }

  let limit = 48;
  if (raw['limit'] != null) {
    limit = Number(raw['limit']);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ValidationError('"limit" must be an integer between 1 and 100.');
    }
  }

  return { q, market: market.code, category, gender, size, sort: sortRaw as SortKey, minPrice, maxPrice, limit };
}

function parsePrice(value: unknown, name: string): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new ValidationError(`"${name}" must be a non-negative number.`);
  }
  return n;
}

function sortListings(listings: NormalizedListing[], sort: SortKey): NormalizedListing[] {
  const byPrice = (dir: 1 | -1) => (a: NormalizedListing, b: NormalizedListing) => {
    if (a.price == null && b.price == null) return 0;
    if (a.price == null) return 1;
    if (b.price == null) return -1;
    return (a.price - b.price) * dir;
  };

  switch (sort) {
    case 'price_asc':
      return [...listings].sort(byPrice(1));
    case 'price_desc':
      return [...listings].sort(byPrice(-1));
    case 'newest': {
      // Sort each source's own listings by date descending first.
      const byDate = (x: NormalizedListing) =>
        x.publishedAt
          ? Date.parse(x.publishedAt)
          : x.fetchedAt
            ? Date.parse(x.fetchedAt)
            : 0;
      const groups = new Map<string, NormalizedListing[]>();
      for (const l of listings) {
        const g = groups.get(l.source) ?? [];
        g.push(l);
        groups.set(l.source, g);
      }
      for (const g of groups.values()) g.sort((a, b) => byDate(b) - byDate(a));
      // Interleave across sources (round-robin) so a single high-volume or
      // undated source cannot starve the others in the merged top-N.
      const result: NormalizedListing[] = [];
      const iters = [...groups.values()];
      let progressed = true;
      while (result.length < listings.length && progressed) {
        progressed = false;
        for (const g of iters) {
          if (g.length > 0) {
            result.push(g.shift()!);
            progressed = true;
            if (result.length >= listings.length) break;
          }
        }
      }
      return result;
    }
    case 'best':
    default:
      return listings; // keep adapter ranking order
  }
}

/**
 * Fan a query out to every enabled adapter concurrently. A failing source
 * is reported in the response but never aborts the whole search.
 */
export async function runSearch(
  adapters: MarketplaceAdapter[],
  query: SearchQuery,
): Promise<SearchResponse> {
  const started = Date.now();
  const perAdapterLimit = query.limit;

  const settled = await Promise.allSettled(
    adapters.map(async (adapter) => {
      const t0 = Date.now();
      const listings = await adapter.search({
        q: query.q,
        limit: perAdapterLimit,
        market: query.market,
        category: query.category ?? undefined,
        gender: query.gender ?? undefined,
        size: query.size ?? undefined,
      });
      return { adapter, listings, latencyMs: Date.now() - t0 };
    }),
  );

  let listings: NormalizedListing[] = [];
  const sources: SearchResponse['sources'] = [];

  const inferGender = (title: string): 'male' | 'female' | 'unisex' | null => {
    const t = ` ${title.toLowerCase()} `;
    if (/\b(unisex|unisexe)\b/.test(t)) return 'unisex';
    if (/\b(damen|frauen|women|woman|female|femmes|femme|ladies|girls?|donna|donne|mujer(?:es)?|vrouw(?:en)?|feminin)\b/.test(t)) return 'female';
    if (/\b(herren|männer|manner|men|man|male|hommes|homme|boys?|uomo|uomini|hombre(?:s)?|mannelijk|masculin)\b/.test(t)) return 'male';
    return null;
  };

  settled.forEach((result, i) => {
    const adapter = adapters[i];
    if (result.status === 'fulfilled') {
      listings.push(...result.value.listings);
      sources.push({
        source: adapter.id,
        label: adapter.label,
        mode: adapter.mode,
        enabled: true,
        disabledReason: null,
        status: 'ok',
        count: result.value.listings.length,
        latencyMs: result.value.latencyMs,
      });
      logEvent(
        adapter.id,
        'ok',
        `Q "${query.q}" → ${result.value.listings.length} results (${result.value.latencyMs}ms)`,
      );
    } else {
      const err = result.reason;
      const message =
        err instanceof SourceError
          ? err.message
          : `Unexpected adapter failure: ${String(err)}`;
      sources.push({
        source: adapter.id,
        label: adapter.label,
        mode: adapter.mode,
        enabled: true,
        disabledReason: null,
        status: 'error',
        count: 0,
        error: message,
      });
      logEvent(adapter.id, 'error', `Q "${query.q}" failed — ${message}`);
    }
  });

  const inferSize = (title: string): string | null => {
    const t = title.toLowerCase();
    // EU numeric size like Gr. 42, size 42, 42 EU
    const m = t.match(/(?:gr\.?|size|eu)\s*(\d{2,3})/);
    if (m) return m[1];
    const letter = t.match(/\b(xxs|xs|s|m|l|xl|xxl|xxxl)\b/);
    if (letter) return letter[1].toUpperCase();
    return null;
  };
  // Infer gender/size where missing, then apply filters.
  for (const l of listings) {
    if (l.gender == null) l.gender = inferGender(`${l.title} ${l.description ?? ''}`);
    if (l.size == null) l.size = inferSize(`${l.title} ${l.description ?? ''}`);
  }
  if (query.gender) {
    listings = listings.filter((l) => l.gender === query.gender || l.gender == null);
  }
  if (query.size) {
    listings = listings.filter((l) => !l.size || l.size.toLowerCase() === query.size);
  }

  listings = listings.filter((l) => {
    if (query.minPrice != null && l.price != null && l.price < query.minPrice) return false;
    if (query.maxPrice != null && l.price != null && l.price > query.maxPrice) return false;
    return true;
  });

  listings = sortListings(listings, query.sort).slice(0, query.limit);

  const isSampleData =
    listings.length > 0 && new Set(listings.map((l) => l.source)).size === 1 &&
    adapters.find((a) => a.id === listings[0].source)?.mode === 'sample';

  return {
    query: query.q,
    market: query.market,
    sort: query.sort,
    total: listings.length,
    tookMs: Date.now() - started,
    isSampleData,
    listings,
    sources,
  };
}
