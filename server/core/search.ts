import {
  SORTS,
  SourceError,
  type MarketplaceAdapter,
  type NormalizedListing,
  type NormalizedLocation,
  type SearchResponse,
  type SortKey,
  type SourceStatus,
} from '../core/types.js';
import { logEvent } from './events.js';
import { DEFAULT_MARKET, findMarket, MARKETS } from './markets.js';

export interface SearchQuery {
  q: string;
  market: string;
  category: string | null;
  gender: string | null;
  size: string | null;
  sort: SortKey;
  minPrice: number | null;
  maxPrice: number | null;
  limit: number;
}

const ADAPTER_TIMEOUT_MS = Math.max(3_000, Number(process.env.SEARCH_ADAPTER_TIMEOUT_MS) || 18_000);
const STALE_AFTER_DAYS = 30;
const AGING_AFTER_DAYS = 14;
const fxCache = new Map<string, { rate: number; at: number }>();

export class ValidationError extends Error {
  readonly statusCode = 400;
  constructor(message: string) { super(message); this.name = 'ValidationError'; }
}

export function parseSearchParams(raw: Record<string, unknown>, defaultMarket = DEFAULT_MARKET): SearchQuery {
  const marketRaw = typeof raw.market === 'string' && raw.market.trim() ? raw.market.trim().toUpperCase() : defaultMarket;
  const market = findMarket(marketRaw);
  if (!market) throw new ValidationError(`Invalid "market" value. Allowed: ${MARKETS.map((m) => m.code).join(', ')}.`);
  const category = typeof raw.category === 'string' ? raw.category.trim() : null;
  const genderRaw = typeof raw.gender === 'string' ? raw.gender.trim().toLowerCase() : '';
  const gender = ['male', 'female', 'unisex'].includes(genderRaw) ? genderRaw : null;
  const sizeRaw = typeof raw.size === 'string' ? raw.size.trim() : '';
  const size = sizeRaw ? sizeRaw.toLowerCase() : null;
  const q = typeof raw.q === 'string' ? raw.q.trim() : '';
  if (!q) throw new ValidationError('Query parameter "q" is required and must be non-empty.');
  if (q.length > 200) throw new ValidationError('Query parameter "q" must be at most 200 characters.');
  const sortRaw = typeof raw.sort === 'string' ? raw.sort : 'newest';
  if (!(SORTS as readonly string[]).includes(sortRaw)) throw new ValidationError(`Invalid "sort" value. Allowed: ${SORTS.join(', ')}.`);
  const minPrice = parsePrice(raw.minPrice, 'minPrice');
  const maxPrice = parsePrice(raw.maxPrice, 'maxPrice');
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) throw new ValidationError('"minPrice" must not exceed "maxPrice".');
  let limit = 48;
  if (raw.limit != null) {
    limit = Number(raw.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ValidationError('"limit" must be an integer between 1 and 100.');
  }
  return { q, market: market.code, category, gender, size, sort: sortRaw as SortKey, minPrice, maxPrice, limit };
}

function parsePrice(value: unknown, name: string): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new ValidationError(`"${name}" must be a non-negative number.`);
  return n;
}

/** Accent-, punctuation- and whitespace-insensitive query representation. */
export function normalizeSearchText(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
    .replace(/[’'']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

const EQUIVALENTS: Record<string, string[]> = {
  bike: ['bicycle', 'velo', 'fahrrad', 'fahrrad'],
  bicycle: ['bike', 'velo', 'fahrrad'],
  velo: ['bike', 'bicycle', 'fahrrad'],
  fahrrad: ['bike', 'bicycle', 'velo'],
  sofa: ['couch', 'canape'],
  couch: ['sofa', 'canape'],
  phone: ['smartphone', 'mobile'],
  smartphone: ['phone', 'mobile'],
  sneakers: ['trainers', 'turnschuhe'],
  trainers: ['sneakers', 'turnschuhe'],
};

function queryTerms(query: string): string[] {
  const terms = normalizeSearchText(query).split(' ').filter((t) => t.length > 1);
  return [...new Set(terms.flatMap((t) => [t, ...(EQUIVALENTS[t] ?? [])]))];
}

export function scoreRelevance(query: string, listing: Pick<NormalizedListing, 'title' | 'description'>): number {
  const normalizedQuery = normalizeSearchText(query);
  const title = normalizeSearchText(listing.title);
  const description = normalizeSearchText(listing.description ?? '');
  if (!normalizedQuery || !title) return 0;
  const originalTerms = normalizedQuery.split(' ').filter(Boolean);
  const expandedTerms = queryTerms(query);
  const matched = expandedTerms.filter((term) => title.split(' ').includes(term) || description.split(' ').includes(term));
  const titleMatched = expandedTerms.filter((term) => title.split(' ').includes(term));
  const coverage = matched.length / Math.max(1, expandedTerms.length);
  const titleCoverage = titleMatched.length / Math.max(1, expandedTerms.length);
  let score = titleCoverage * 62 + coverage * 18;
  if (title.includes(normalizedQuery)) score += 20;
  else if (normalizedQuery.split(' ').every((term) => title.includes(term))) score += 10;
  if (originalTerms.length === 1 && title.startsWith(normalizedQuery)) score += 4;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|ref$|source$|campaign$|tracking)/i.test(key)) u.searchParams.delete(key);
    }
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    return u.toString().replace(/\/$/, '');
  } catch { return raw.trim().toLowerCase().replace(/\/$/, ''); }
}

function fingerprint(l: NormalizedListing): string {
  const title = normalizeSearchText(l.title);
  const price = l.price == null ? 'na' : `${Math.round(l.price * 100) / 100}:${l.currency.toUpperCase()}`;
  const location = normalizeSearchText(l.location ?? '');
  return [title, price, location].join('|');
}

/** Conservative cross-source grouping; title/price/location must all agree. */
export function deduplicateListings(input: NormalizedListing[]): { listings: NormalizedListing[]; removed: number } {
  const groups: NormalizedListing[][] = [];
  const byUrl = new Map<string, number>();
  const byFingerprint = new Map<string, number>();
  for (const listing of input) {
    const url = canonicalUrl(listing.listingUrl);
    const fp = fingerprint(listing);
    const urlGroup = url ? byUrl.get(url) : undefined;
    const fpGroup = byFingerprint.get(fp);
    let index = urlGroup ?? fpGroup;
    if (index != null && groups[index].some((x) => x.source !== listing.source)) {
      groups[index].push(listing);
      continue;
    }
    index = groups.length;
    groups.push([listing]);
    if (url) byUrl.set(url, index);
    byFingerprint.set(fp, index);
  }
  const listings = groups.map((group) => {
    const primary = { ...group[0] };
    if (group.length > 1) {
      primary.duplicateCount = group.length - 1;
      primary.duplicateListings = group.slice(1).map((x) => ({ source: x.source, listingUrl: x.listingUrl }));
      if (!primary.imageUrl) primary.imageUrl = group.find((x) => x.imageUrl)?.imageUrl ?? null;
      if (!primary.description) primary.description = group.find((x) => x.description)?.description ?? '';
    }
    return primary;
  });
  return { listings, removed: input.length - listings.length };
}

function normalizeLocation(raw: string | null, market: string): NormalizedLocation | null {
  if (!raw?.trim()) return null;
  const text = raw.trim();
  const postal = text.match(/\b(\d{4,6})\b/)?.[1] ?? null;
  const parts = text.split(/[,·|]/).map((x) => x.trim()).filter(Boolean);
  const region = parts.length > 1 ? parts[parts.length - 1] : null;
  const city = parts.find((p) => !/\b\d{4,6}\b/.test(p) && p !== region) ?? (postal ? text.slice(0, text.indexOf(postal)).trim() || null : null);
  return { raw: text, countryCode: market, region, city, postalCode: postal, latitude: null, longitude: null };
}

function freshness(publishedAt: string | null, fetchedAt: string): { freshness: NonNullable<NormalizedListing['freshness']>; ageDays: number | null } {
  if (!publishedAt) return { freshness: 'unknown', ageDays: null };
  const date = Date.parse(publishedAt);
  if (!Number.isFinite(date) || date > Date.now() + 86_400_000) return { freshness: 'unknown', ageDays: null };
  const ageDays = Math.max(0, Math.floor((Date.now() - date) / 86_400_000));
  return { freshness: ageDays > STALE_AFTER_DAYS ? 'stale' : ageDays > AGING_AFTER_DAYS ? 'aging' : 'fresh', ageDays };
}

async function getFxRate(from: string, to: string): Promise<number | null> {
  if (from === to) return 1;
  const key = `${from}:${to}`;
  const cached = fxCache.get(key);
  if (cached && Date.now() - cached.at < 3_600_000) return cached.rate;
  try {
    const response = await fetch(`https://api.frankfurter.app/latest?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { signal: AbortSignal.timeout(2_500) });
    if (!response.ok) return null;
    const data = await response.json() as { rates?: Record<string, number> };
    const rate = data.rates?.[to];
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
    fxCache.set(key, { rate, at: Date.now() });
    return rate;
  } catch { return null; }
}

function sortListings(listings: NormalizedListing[], sort: SortKey): NormalizedListing[] {
  const byPrice = (dir: 1 | -1) => (a: NormalizedListing, b: NormalizedListing) => {
    const ap = a.marketPrice ?? (a.currency === a.marketCurrency ? a.price : null);
    const bp = b.marketPrice ?? (b.currency === b.marketCurrency ? b.price : null);
    if (ap == null && bp == null) return 0;
    if (ap == null) return 1;
    if (bp == null) return -1;
    return (ap - bp) * dir;
  };
  switch (sort) {
    case 'price_asc': return [...listings].sort(byPrice(1));
    case 'price_desc': return [...listings].sort(byPrice(-1));
    case 'newest': return [...listings].sort((a, b) => {
      const date = (x: NormalizedListing) => x.publishedAt ? Date.parse(x.publishedAt) : 0;
      return date(b) - date(a);
    });
    case 'best':
    default: return [...listings].sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));
  }
}

function inferGender(title: string): 'male' | 'female' | 'unisex' | null {
  const t = ` ${title.toLowerCase()} `;
  if (/\b(unisex|unisexe)\b/.test(t)) return 'unisex';
  if (/\b(damen|frauen|women|woman|female|femmes|femme|ladies|girls?|donna|donne|mujer(?:es)?|vrouw(?:en)?|feminin)\b/.test(t)) return 'female';
  if (/\b(herren|männer|manner|men|man|male|hommes|homme|boys?|uomo|uomini|hombre(?:s)?|mannelijk|masculin)\b/.test(t)) return 'male';
  return null;
}

function inferSize(title: string): string | null {
  const t = title.toLowerCase();
  const m = t.match(/(?:gr\.?|size|eu)\s*(\d{2,3})/);
  if (m) return m[1];
  const letter = t.match(/\b(xxs|xs|s|m|l|xl|xxl|xxxl)\b/);
  return letter ? letter[1].toUpperCase() : null;
}

function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error(`Adapter timed out after ${ms}ms`), { code: 'TIMEOUT' })), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

export async function runSearch(adapters: MarketplaceAdapter[], query: SearchQuery): Promise<SearchResponse> {
  const started = Date.now();
  const normalizedQuery = normalizeSearchText(query.q);
  const marketCurrency = findMarket(query.market)?.currency ?? 'CHF';
  const settled = await Promise.all(adapters.map(async (adapter) => {
    const t0 = Date.now();
    try {
      const listings = await timeout(adapter.search({
        q: normalizedQuery || query.q,
        limit: query.limit,
        market: query.market,
        category: query.category ?? undefined,
        gender: query.gender ?? undefined,
        size: query.size ?? undefined,
      }), ADAPTER_TIMEOUT_MS);
      return { adapter, listings, latencyMs: Date.now() - t0, status: 'ok' as const };
    } catch (error) {
      const latencyMs = Date.now() - t0;
      const isTimeout = (error as { code?: string })?.code === 'TIMEOUT';
      const message = error instanceof SourceError ? error.message : error instanceof Error ? error.message : String(error);
      return { adapter, error: message, latencyMs, status: isTimeout ? 'timeout' as const : 'error' as const };
    }
  }));

  let listings: NormalizedListing[] = [];
  const sources: SourceStatus[] = settled.map((result) => {
    if (result.status === 'ok') {
      listings.push(...result.listings.map((listing) => ({ ...listing, source: result.adapter.id })));
      logEvent(result.adapter.id, 'ok', `Q "${query.q}" → ${result.listings.length} results (${result.latencyMs}ms)`);
      return { source: result.adapter.id, label: result.adapter.label, mode: result.adapter.mode, enabled: true, disabledReason: null, status: 'ok', count: result.listings.length, latencyMs: result.latencyMs };
    }
    logEvent(result.adapter.id, 'error', `Q "${query.q}" failed — ${result.error}`);
    return { source: result.adapter.id, label: result.adapter.label, mode: result.adapter.mode, enabled: true, disabledReason: null, status: result.status, count: 0, latencyMs: result.latencyMs, error: result.error };
  });

  for (const l of listings) {
    if (l.gender == null) l.gender = inferGender(`${l.title} ${l.description ?? ''}`);
    if (l.size == null) l.size = inferSize(`${l.title} ${l.description ?? ''}`);
    l.relevanceScore = scoreRelevance(query.q, l);
    l.normalizedLocation = normalizeLocation(l.location, query.market);
    const fresh = freshness(l.publishedAt, l.fetchedAt);
    l.freshness = fresh.freshness;
    l.ageDays = fresh.ageDays;
    l.marketCurrency = marketCurrency;
  }

  // Convert each source currency to the market currency once per distinct pair.
  const currencies = [...new Set(listings.map((l) => l.currency.toUpperCase()).filter((c) => c && c !== marketCurrency))];
  const rates = new Map<string, number | null>();
  await Promise.all(currencies.map(async (currency) => rates.set(currency, await getFxRate(currency, marketCurrency))));
  for (const l of listings) {
    const currency = l.currency.toUpperCase();
    const rate = currency === marketCurrency ? 1 : rates.get(currency) ?? null;
    l.fxRate = rate;
    l.marketPrice = l.price == null || rate == null ? null : Math.round(l.price * rate * 100) / 100;
  }

  if (query.gender) listings = listings.filter((l) => l.gender === query.gender || l.gender == null);
  if (query.size) listings = listings.filter((l) => !l.size || l.size.toLowerCase() === query.size);
  listings = listings.filter((l) => {
    const price = l.marketPrice;
    if (price == null) return query.minPrice == null && query.maxPrice == null ? true : false;
    if (query.minPrice != null && price < query.minPrice) return false;
    if (query.maxPrice != null && price > query.maxPrice) return false;
    return true;
  });

  const rawTotal = listings.length;
  const deduped = deduplicateListings(listings);
  listings = sortListings(deduped.listings, query.sort).slice(0, query.limit);
  const isSampleData = listings.length > 0 && new Set(listings.map((l) => l.source)).size === 1 &&
    adapters.find((a) => a.id === listings[0].source)?.mode === 'sample';

  return {
    query: query.q,
    normalizedQuery,
    market: query.market,
    marketCurrency,
    sort: query.sort,
    total: listings.length,
    rawTotal,
    duplicatesRemoved: deduped.removed,
    tookMs: Date.now() - started,
    isSampleData,
    listings,
    sources,
  };
}
