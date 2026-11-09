import {
  SORTS, SourceError, type MarketplaceAdapter, type NormalizedListing, type SearchResponse,
  type SortKey, type SourceStatus,
} from '../core/types.js';
import { logEvent } from './events.js';
import { DEFAULT_MARKET, findMarket, MARKETS } from './markets.js';

export interface SearchQuery {
  q: string; market: string; category: string | null; gender: string | null; size: string | null;
  sort: SortKey; minPrice: number | null; maxPrice: number | null; limit: number;
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

/** Accent-, punctuation- and whitespace-insensitive canonical query/title representation. */
export function normalizeSearchText(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
    .replace(/[’'']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

const EQUIVALENTS: Record<string, string[]> = {
  bike: ['bicycle', 'velo', 'fahrrad'], bicycle: ['bike', 'velo', 'fahrrad'],
  velo: ['bike', 'bicycle', 'fahrrad'], fahrrad: ['bike', 'bicycle', 'velo'],
  sofa: ['couch', 'canape'], couch: ['sofa', 'canape'], canape: ['sofa', 'couch'],
  phone: ['smartphone', 'mobile', 'handy'], smartphone: ['phone', 'mobile', 'handy'],
  sneakers: ['trainers', 'turnschuhe'], trainers: ['sneakers', 'turnschuhe'],
  jacket: ['coat', 'jacke', 'veste'], coat: ['jacket', 'mantel'],
  watch: ['uhr', 'montre'], uhr: ['watch', 'montre'],
  chair: ['stuhl', 'chaise'], stuhl: ['chair', 'chaise'],
  table: ['tisch', 'table'], tisch: ['table'],
};

function queryTerms(query: string): string[] {
  const terms = normalizeSearchText(query).split(' ').filter((t) => t.length > 1);
  return [...new Set(terms.flatMap((t) => [t, ...(EQUIVALENTS[t] ?? [])]))];
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 5) return false;
  let i = 0; let j = 0; let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + ((i < a.length || j < b.length) ? 1 : 0) <= 1;
}

export function scoreRelevance(query: string, listing: Pick<NormalizedListing, 'title' | 'description'>): number {
  const normalizedQuery = normalizeSearchText(query);
  const title = normalizeSearchText(listing.title);
  const description = normalizeSearchText(listing.description ?? '');
  if (!normalizedQuery || !title) return 0;
  const original = normalizedQuery.split(' ').filter(Boolean);
  const expanded = queryTerms(query);
  const titleTokens = title.split(' ');
  const descriptionTokens = description.split(' ');
  const matches = (term: string, tokens: string[]) => tokens.some((token) => token === term || editDistanceAtMostOne(term, token));
  const titleMatched = original.filter((term) => matches(term, titleTokens) || (EQUIVALENTS[term] ?? []).some((alt) => matches(alt, titleTokens)));
  const bodyMatched = original.filter((term) => matches(term, descriptionTokens) || (EQUIVALENTS[term] ?? []).some((alt) => matches(alt, descriptionTokens)));
  const coverage = titleMatched.length / Math.max(1, original.length);
  const bodyCoverage = bodyMatched.length / Math.max(1, original.length);
  const expandedTitleHits = expanded.filter((term) => matches(term, titleTokens)).length;
  let score = coverage * 72 + bodyCoverage * 12 + Math.min(12, expandedTitleHits * 4);
  if (title.includes(normalizedQuery)) score += 16;
  else if (original.length > 1 && original.every((term) => title.includes(term))) score += 8;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw); u.hash = '';
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|ref$|source$|campaign$|tracking)/i.test(key)) u.searchParams.delete(key);
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    return u.toString().replace(/\/$/, '');
  } catch { return raw.trim().toLowerCase().replace(/\/$/, ''); }
}

function titleSimilarity(a: string, b: string): number {
  const aa = new Set(normalizeSearchText(a).split(' ').filter((x) => x.length > 1));
  const bb = new Set(normalizeSearchText(b).split(' ').filter((x) => x.length > 1));
  if (!aa.size || !bb.size) return 0;
  let intersection = 0;
  for (const token of aa) if (bb.has(token)) intersection++;
  return intersection / (aa.size + bb.size - intersection);
}

function samePrice(a: NormalizedListing, b: NormalizedListing): boolean {
  if (a.price == null || b.price == null) return a.price == null && b.price == null;
  if (a.currency.toUpperCase() !== b.currency.toUpperCase()) return false;
  const max = Math.max(a.price, b.price, 1);
  return Math.abs(a.price - b.price) / max <= 0.02;
}

function sameLocation(a: NormalizedListing, b: NormalizedListing): boolean {
  const aa = normalizeSearchText(a.location ?? '');
  const bb = normalizeSearchText(b.location ?? '');
  if (!aa || !bb) return !aa && !bb;
  return aa === bb || aa.includes(bb) || bb.includes(aa);
}

/** Conservative cross-marketplace grouping: identical URL or near-identical title + price + location. */
export function deduplicateListings(input: NormalizedListing[]): { listings: NormalizedListing[]; removed: number } {
  const groups: NormalizedListing[][] = [];
  const urlGroups = new Map<string, number>();
  for (const listing of input) {
    const url = canonicalUrl(listing.listingUrl);
    let index = urlGroups.get(url);
    if (index == null) {
      index = groups.findIndex((group) => group.some((candidate) =>
        candidate.source !== listing.source &&
        titleSimilarity(candidate.title, listing.title) >= 0.82 &&
        samePrice(candidate, listing) && sameLocation(candidate, listing)));
      if (index < 0) index = undefined;
    }
    if (index != null && groups[index].some((x) => x.source !== listing.source)) {
      groups[index].push(listing);
      if (url) urlGroups.set(url, index);
      continue;
    }
    const next = groups.length;
    groups.push([listing]);
    if (url) urlGroups.set(url, next);
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

/** Parse location fields without claiming geocoding; coordinates remain null until a geocoder is configured. */
export function normalizeLocation(raw: string | null, market: string): NonNullable<NormalizedListing['normalizedLocation']> | null {
  if (!raw?.trim()) return null;
  const text = raw.trim();
  const postal = text.match(/\b(\d{4,6})\b/)?.[1] ?? null;
  const parts = text.split(/[,·|]/).map((x) => x.trim()).filter(Boolean);
  const city = parts[0]?.replace(/\b\d{4,6}\b/g, '').trim() || (postal ? text.slice(0, text.indexOf(postal)).trim() || null : text);
  const region = parts.length > 1 ? parts.slice(1).join(', ') : null;
  return { raw: text, countryCode: market.toUpperCase(), region, city, postalCode: postal, latitude: null, longitude: null };
}

function freshness(publishedAt: string | null): { freshness: NonNullable<NormalizedListing['freshness']>; ageDays: number | null } {
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
  const price = (l: NormalizedListing) => l.marketPrice ?? (l.currency.toUpperCase() === l.marketCurrency ? l.price : null);
  const byPrice = (dir: 1 | -1) => (a: NormalizedListing, b: NormalizedListing) => {
    const ap = price(a); const bp = price(b);
    if (ap == null && bp == null) return 0;
    if (ap == null) return 1;
    if (bp == null) return -1;
    return (ap - bp) * dir;
  };
  switch (sort) {
    case 'price_asc': return [...listings].sort(byPrice(1));
    case 'price_desc': return [...listings].sort(byPrice(-1));
    case 'newest': return [...listings].sort((a, b) => Date.parse(b.publishedAt ?? '') - Date.parse(a.publishedAt ?? ''));
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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
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
      const listings = await withTimeout(adapter.search({
        q: normalizedQuery || query.q, limit: query.limit, market: query.market,
        category: query.category ?? undefined, gender: query.gender ?? undefined, size: query.size ?? undefined,
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

  for (const listing of listings) {
    if (listing.gender == null) listing.gender = inferGender(`${listing.title} ${listing.description ?? ''}`);
    if (listing.size == null) listing.size = inferSize(`${listing.title} ${listing.description ?? ''}`);
    listing.relevanceScore = scoreRelevance(query.q, listing);
    listing.normalizedLocation = normalizeLocation(listing.location, query.market);
    const age = freshness(listing.publishedAt);
    listing.freshness = age.freshness;
    listing.ageDays = age.ageDays;
    listing.marketCurrency = marketCurrency;
  }

  const currencies = [...new Set(listings.map((l) => l.currency.toUpperCase()).filter((c) => c && c !== marketCurrency))];
  const rates = new Map<string, number | null>();
  await Promise.all(currencies.map(async (currency) => rates.set(currency, await getFxRate(currency, marketCurrency))));
  for (const listing of listings) {
    const currency = listing.currency.toUpperCase();
    const rate = currency === marketCurrency ? 1 : rates.get(currency) ?? null;
    listing.fxRate = rate;
    listing.marketPrice = listing.price == null || rate == null ? null : Math.round(listing.price * rate * 100) / 100;
  }

  if (query.gender) listings = listings.filter((l) => l.gender === query.gender || l.gender == null);
  if (query.size) listings = listings.filter((l) => !l.size || l.size.toLowerCase() === query.size);
  // Unknown conversion rates remain visible rather than disappearing from price-filtered searches.
  listings = listings.filter((l) => {
    const comparable = l.marketPrice;
    if (comparable == null) return true;
    if (query.minPrice != null && comparable < query.minPrice) return false;
    if (query.maxPrice != null && comparable > query.maxPrice) return false;
    return true;
  });

  const rawTotal = listings.length;
  const deduped = deduplicateListings(listings);
  listings = sortListings(deduped.listings, query.sort).slice(0, query.limit);
  const isSampleData = listings.length > 0 && new Set(listings.map((l) => l.source)).size === 1 &&
    adapters.find((a) => a.id === listings[0].source)?.mode === 'sample';

  return {
    query: query.q, normalizedQuery, market: query.market, marketCurrency, sort: query.sort,
    total: listings.length, rawTotal, duplicatesRemoved: deduped.removed, tookMs: Date.now() - started,
    isSampleData, listings, sources,
  };
}
