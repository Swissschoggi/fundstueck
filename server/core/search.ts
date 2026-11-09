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
import { recordPrices } from './deal-radar.js';

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

  const genderRaw = typeof raw['gender'] === 'string' ? raw['gender'].trim().toLowerCase() : '';
  const gender = ['male', 'female', 'unisex'].includes(genderRaw) ? genderRaw : null;
  const sizeRaw = typeof raw['size'] === 'string' ? raw['size'].trim() : '';
  const size = sizeRaw ? sizeRaw.toLowerCase() : null;

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

// ---------- Normalization ----------

export function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // punctuation -> space
    .replace(/\s+/g, ' ')
    .trim();
}

// Common multilingual synonyms (careful, limited set).
const SYNONYMS: Record<string, string[]> = {
  'iphone': ['iphone', 'i phone'],
  'velo': ['velo', 'velos', 'bicycle', 'bike', 'fahrrad', 'velo'],
  'laptop': ['laptop', 'notebook', 'ordinateur portable'],
};

export function expandQueryTokens(q: string): string[] {
  const base = normalizeText(q).split(' ').filter(Boolean);
  const expanded = new Set<string>(base);
  for (const t of base) {
    const syns = SYNONYMS[t];
    if (syns) for (const s of syns) expanded.add(s);
  }
  return [...expanded];
}

// ---------- Relevance scoring ----------

function scoreListing(listing: NormalizedListing, queryTokens: string[], normalizedQuery: string): number {
  const titleNorm = normalizeText(listing.title);
  const descNorm = normalizeText(listing.description || '');
  const titleTokens = titleNorm.split(' ').filter(Boolean);
  let score = 0;
  // Exact phrase in title
  if (titleNorm.includes(normalizedQuery)) score += 50;
  // Exact phrase in description
  if (descNorm.includes(normalizedQuery)) score += 20;
  // Token coverage
  let matched = 0;
  for (const qt of queryTokens) {
    if (titleTokens.includes(qt)) { score += 10; matched++; }
    else if (titleNorm.includes(qt)) { score += 5; matched++; }
    else if (descNorm.includes(qt)) { score += 2; }
  }
  // Token coverage bonus
  if (queryTokens.length > 0) score += (matched / queryTokens.length) * 20;
  // Model numbers (alphanumeric tokens like iphone15, m6)
  for (const qt of queryTokens) {
    if (/[a-z]+\d+/.test(qt) && titleNorm.replace(/\s/g, '').includes(qt)) score += 15;
  }
  // Freshness bonus
  if (listing.publishedAt) {
    const age = Date.now() - Date.parse(listing.publishedAt);
    if (age < 7 * 24 * 3600 * 1000) score += 5;
  }
  return score;
}

// ---------- Price conversion ----------

// Approximate static rates to CHF (base). For production, replace with a
// timestamped rate service. Values are indicative only.
const RATES_TO_CHF: Record<string, number> = {
  CHF: 1, EUR: 0.95, USD: 0.88, GBP: 1.12, SEK: 0.082, NOK: 0.083,
  DKK: 0.128, PLN: 0.22, CZK: 0.038, HUF: 0.0024, RON: 0.19,
  JPY: 0.0056, KRW: 0.00062, CNY: 0.12, TWD: 0.027, HKD: 0.113,
  SGD: 0.65, MYR: 0.19, IDR: 0.000055, THB: 0.024, PHP: 0.015,
  VND: 0.000034, INR: 0.0105, PKR: 0.0032, BDT: 0.0073, LKR: 0.0027,
  AUD: 0.57, NZD: 0.53, CAD: 0.64, MXN: 0.043, BRL: 0.16, ARS: 0.0008,
  CLP: 0.0009, COP: 0.0002, PEN: 0.23, UYU: 0.02, AED: 0.24,
  SAR: 0.235, JOD: 1.24, EGP: 0.018, ILS: 0.235, TRY: 0.026,
  IRR: 0.000019, ZAR: 0.048, NGN: 0.00055, KES: 0.0067, GHS: 0.058,
  MAD: 0.087, DZD: 0.0065, TND: 0.28, RSD: 0.0081, BGN: 0.485,
  UAH: 0.022, MDL: 0.049, BAM: 0.485, ALL: 0.009, RUB: 0.009,
  KZT: 0.0018, GEL: 0.32, AMD: 0.0023, AZN: 0.52, BYN: 0.27,
};

function toMarketCurrency(amount: number, from: string, to: string): number {
  const fromRate = RATES_TO_CHF[from.toUpperCase()] ?? 1;
  const toRate = RATES_TO_CHF[to.toUpperCase()] ?? 1;
  if (!toRate) return amount;
  return (amount * fromRate) / toRate;
}

// ---------- Deduplication ----------

function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    return (u.origin + u.pathname).toLowerCase().replace(/\/$/, '');
  } catch {
    return url.toLowerCase();
  }
}

function dedupKey(l: NormalizedListing): string {
  const url = canonicalUrl(l.listingUrl);
  if (url) return `url:${url}`;
  const normTitle = normalizeText(l.title);
  const price = l.price != null ? Math.round(l.price) : 'na';
  const loc = normalizeText(l.location || '');
  return `title:${normTitle}|${price}|${loc}`;
}

// ---------- Main pipeline ----------

const ADAPTER_TIMEOUT_MS = 8000;

export async function runSearch(
  adapters: MarketplaceAdapter[],
  query: SearchQuery,
): Promise<SearchResponse> {
  const started = Date.now();
  const perAdapterLimit = query.limit;
  const market = findMarket(query.market);
  const targetCurrency = market?.currency ?? query.market;

  const normalizedQuery = normalizeText(query.q);
  const queryTokens = expandQueryTokens(query.q);

  const settled = await Promise.allSettled(
    adapters.map(async (adapter) => {
      const t0 = Date.now();
      try {
        const listings = await Promise.race([
          adapter.search({
            q: query.q,
            limit: perAdapterLimit,
            market: query.market,
            category: query.category ?? undefined,
            gender: query.gender ?? undefined,
            size: query.size ?? undefined,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Adapter timeout')), ADAPTER_TIMEOUT_MS),
          ),
        ]);
        return { adapter, listings, latencyMs: Date.now() - t0, timedOut: false };
      } catch (err) {
        const timedOut = err instanceof Error && err.message === 'Adapter timeout';
        throw { adapter, err, latencyMs: Date.now() - t0, timedOut };
      }
    }),
  );

  let listings: NormalizedListing[] = [];
  const sources: SearchResponse['sources'] = [];

  settled.forEach((result, i) => {
    const adapter = adapters[i];
    if (result.status === 'fulfilled') {
      const val = result.value as { adapter: MarketplaceAdapter; listings: NormalizedListing[]; latencyMs: number; timedOut: boolean };
      // Score relevance
      for (const l of val.listings) {
        (l as NormalizedListing & { _score?: number })._score = scoreListing(l, queryTokens, normalizedQuery);
      }
      listings.push(...val.listings);
      sources.push({
        source: adapter.id,
        label: adapter.label,
        mode: adapter.mode,
        enabled: true,
        disabledReason: null,
        status: 'ok',
        count: val.listings.length,
        latencyMs: val.latencyMs,
      });
      logEvent(adapter.id, 'ok', `Q "${query.q}" → ${val.listings.length} results (${val.latencyMs}ms)`);
    } else {
      const reason = result.reason as { adapter: MarketplaceAdapter; err: unknown; latencyMs: number; timedOut: boolean };
      const err = reason?.err ?? result.reason;
      const message =
        err instanceof SourceError
          ? err.message
          : `Unexpected adapter failure: ${String(err)}`;
      const timedOut = Boolean(reason?.timedOut);
      sources.push({
        source: adapter.id,
        label: adapter.label,
        mode: adapter.mode,
        enabled: true,
        disabledReason: null,
        status: timedOut ? 'timeout' : 'error',
        count: 0,
        latencyMs: reason?.latencyMs ?? 0,
        error: message,
        timedOut,
      });
      logEvent(adapter.id, 'error', `Q "${query.q}" failed — ${message}`);
    }
  });

  // Gender/size inference
  const inferGender = (title: string): 'male' | 'female' | 'unisex' | null => {
    const t = ` ${title.toLowerCase()} `;
    if (/\b(unisex|unisexe)\b/.test(t)) return 'unisex';
    if (/\b(damen|frauen|women|woman|female|femmes|femme|ladies|girls?|donna|donne|mujer(?:es)?|vrouw(?:en)?|feminin)\b/.test(t)) return 'female';
    if (/\b(herren|männer|manner|men|man|male|hommes|homme|boys?|uomo|uomini|hombre(?:s)?|mannelijk|masculin)\b/.test(t)) return 'male';
    return null;
  };
  const inferSize = (title: string): string | null => {
    const t = title.toLowerCase();
    const m = t.match(/(?:gr\.?|size|eu)\s*(\d{2,3})/);
    if (m) return m[1];
    const letter = t.match(/\b(xxs|xs|s|m|l|xl|xxl|xxxl)\b/);
    if (letter) return letter[1].toUpperCase();
    return null;
  };
  for (const l of listings) {
    if (l.gender == null) l.gender = inferGender(`${l.title} ${l.description ?? ''}`);
    if (l.size == null) l.size = inferSize(`${l.title} ${l.description ?? ''}`);
  }

  // Filters
  if (query.gender) {
    listings = listings.filter((l) => l.gender === query.gender || l.gender == null);
  }
  if (query.size) {
    const qs = query.size.toLowerCase();
    listings = listings.filter((l) => !l.size || l.size.toLowerCase() === qs);
  }
  listings = listings.filter((l) => {
    if (query.minPrice != null && l.price != null && l.price < query.minPrice) return false;
    if (query.maxPrice != null && l.price != null && l.price > query.maxPrice) return false;
    return true;
  });

  // Price conversion to target currency for sorting (retain original on listing)
  for (const l of listings) {
    if (l.currency && l.currency.toUpperCase() !== targetCurrency.toUpperCase() && l.price != null) {
      (l as NormalizedListing & { _convertedPrice?: number })._convertedPrice = toMarketCurrency(l.price, l.currency, targetCurrency);
    } else if (l.price != null) {
      (l as NormalizedListing & { _convertedPrice?: number })._convertedPrice = l.price;
    }
  }

  // Deduplication: group by canonical URL, then by normalized title+price+location
  const groups = new Map<string, NormalizedListing[]>();
  for (const l of listings) {
    const key = dedupKey(l);
    const g = groups.get(key) ?? [];
    g.push(l);
    groups.set(key, g);
  }
  const deduped: NormalizedListing[] = [];
  for (const g of groups.values()) {
    if (g.length === 1) {
      deduped.push(g[0]);
    } else {
      // Keep the first as primary, but store duplicate links in rawMetadata.
      const primary = g[0];
      const links = g.map((x) => x.listingUrl);
      (primary as NormalizedListing & { _duplicateLinks?: string[] })._duplicateLinks = links;
      deduped.push(primary);
    }
  }
  listings = deduped;

  // Sorting
  const effectivePrice = (l: NormalizedListing) =>
    (l as NormalizedListing & { _convertedPrice?: number })._convertedPrice ?? l.price;

  const sortListings = (arr: NormalizedListing[], sort: SortKey): NormalizedListing[] => {
    switch (sort) {
      case 'price_asc':
        return [...arr].sort((a, b) => {
          const pa = effectivePrice(a), pb = effectivePrice(b);
          if (pa == null && pb == null) return 0;
          if (pa == null) return 1;
          if (pb == null) return -1;
          return pa - pb;
        });
      case 'price_desc':
        return [...arr].sort((a, b) => {
          const pa = effectivePrice(a), pb = effectivePrice(b);
          if (pa == null && pb == null) return 0;
          if (pa == null) return 1;
          if (pb == null) return -1;
          return pb - pa;
        });
      case 'newest':
        return roundRobinBySource(arr, (x) =>
          x.publishedAt ? Date.parse(x.publishedAt) : x.fetchedAt ? Date.parse(x.fetchedAt) : 0,
        );
      case 'best':
      default: {
        // Relevance score descending
        return [...arr].sort((a, b) => {
          const sa = (a as NormalizedListing & { _score?: number })._score ?? 0;
          const sb = (b as NormalizedListing & { _score?: number })._score ?? 0;
          if (sb !== sa) return sb - sa;
          return 0;
        });
      }
    }
  };

  listings = sortListings(listings, query.sort).slice(0, query.limit);

  const isSampleData =
    listings.length > 0 && new Set(listings.map((l) => l.source)).size === 1 &&
    adapters.find((a) => a.id === listings[0].source)?.mode === 'sample';

  // Populate marketPrice/marketCurrency/freshness for the UI.
  const now = Date.now();
  for (const l of listings) {
    const cp = (l as NormalizedListing & { _convertedPrice?: number })._convertedPrice;
    if (cp != null) {
      l.marketPrice = cp;
      l.marketCurrency = targetCurrency;
      l.fxRate = l.price != null && l.price !== 0 ? cp / l.price : null;
    } else if (l.price != null) {
      l.marketPrice = l.price;
      l.marketCurrency = l.currency;
    }
    if (l.publishedAt) {
      const age = now - Date.parse(l.publishedAt);
      const days = Math.floor(age / (24 * 3600 * 1000));
      l.ageDays = days;
      l.freshness = days > 30 ? 'stale' : days > 7 ? 'aging' : 'fresh';
    } else {
      l.ageDays = null;
      l.freshness = 'unknown';
    }
    delete (l as unknown as Record<string, unknown>)._score;
    delete (l as unknown as Record<string, unknown>)._convertedPrice;
    delete (l as unknown as Record<string, unknown>)._duplicateLinks;
  }

  // Record prices for deal radar (best-effort, non-blocking).
  recordPrices(listings).catch(() => {});

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

function roundRobinBySource(arr: NormalizedListing[], keyFn: (x: NormalizedListing) => number): NormalizedListing[] {
  const groups = new Map<string, NormalizedListing[]>();
  for (const l of arr) {
    const g = groups.get(l.source) ?? [];
    g.push(l);
    groups.set(l.source, g);
  }
  for (const g of groups.values()) g.sort((a, b) => keyFn(b) - keyFn(a));
  const result: NormalizedListing[] = [];
  const iters = [...groups.values()];
  let progressed = true;
  while (result.length < arr.length && progressed) {
    progressed = false;
    for (const g of iters) {
      if (g.length > 0) {
        result.push(g.shift()!);
        progressed = true;
        if (result.length >= arr.length) break;
      }
    }
  }
  return result;
}
