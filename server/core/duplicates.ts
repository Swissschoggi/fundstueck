import type { DuplicateListingRef, NormalizedListing } from './types.js';
import { getEngineSettings } from './engine-settings.js';

/**
 * Cross-marketplace duplicate detection.
 *
 * The same physical item is frequently listed on several marketplaces
 * (Ricardo + Tutti + Anibis, or eBay + Kleinanzeigen). We detect those
 * cross-listings so the UI can show a side-by-side comparison and surface
 * the cheapest asking price. Matching is intentionally conservative to avoid
 * collapsing genuinely distinct items into one card.
 */

/** Words that carry no identifying value in a listing title. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'der', 'die', 'das',
  'und', 'oder', 'mit', 'von', 'für', 'fur', 'les', 'des', 'une', 'un', 'et',
  'ou', 'avec', 'pour', 'di', 'da', 'con', 'per', 'il', 'la', 'lo', 'new',
  'neu', 'neuf', 'nuovo', 'sale', 'zu', 'verkaufen', 'occasion', 'top',
]);

export interface DuplicateGroup {
  primary: NormalizedListing;
  others: NormalizedListing[];
}

function norm(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleTokens(title: string): Set<string> {
  const out = new Set<string>();
  for (const t of norm(title).split(' ')) {
    if (t.length < 2) continue;
    if (STOPWORDS.has(t)) continue;
    out.add(t);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    return (u.origin + u.pathname).toLowerCase().replace(/\/$/, '');
  } catch {
    return url.toLowerCase();
  }
}

/** Identity of an image regardless of query-string cache busters/CDN params. */
function imageKey(url: string | null | undefined): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    return (u.host + u.pathname).toLowerCase().replace(/\/$/, '');
  } catch {
    return url.toLowerCase();
  }
}

function priceClose(a: NormalizedListing, b: NormalizedListing): boolean {
  if (a.price == null || b.price == null) return false;
  if (a.currency.toUpperCase() !== b.currency.toUpperCase()) return false;
  const base = Math.max(a.price, b.price);
  if (base <= 0) return false;
  const allowance = getEngineSettings().priceAllowancePct / 100;
  return Math.abs(a.price - b.price) / base <= allowance;
}

interface Prepped {
  listing: NormalizedListing;
  tokens: Set<string>;
  url: string;
  image: string;
}

interface Match {
  score: number;
  reason: string;
}

function matchScore(a: Prepped, b: Prepped): Match | null {
  const engine = getEngineSettings();
  if (a.url && a.url === b.url) return { score: 1, reason: 'same-url' };
  if (engine.imageMatch && a.image && a.image === b.image) return { score: 0.95, reason: 'same-image' };

  const sameSource = a.listing.source === b.listing.source;
  const similarity = jaccard(a.tokens, b.tokens);
  const priceOk = priceClose(a.listing, b.listing);
  const enoughTokens = a.tokens.size >= 2 && b.tokens.size >= 2;

  // Near-identical titles are the strongest signal after identical media.
  if (enoughTokens && similarity >= engine.titleThreshold) {
    // Within one marketplace, identical titles are common for stock/generic
    // products — only merge those when the price also matches.
    if (sameSource && !priceOk) return null;
    return { score: Math.min(0.92, 0.55 + similarity * 0.4), reason: 'title-match' };
  }

  // Softer title overlap is only trusted together with a matching price.
  if (a.tokens.size >= 3 && b.tokens.size >= 3 && similarity >= 0.6 && priceOk) {
    return { score: 0.6 + similarity * 0.2, reason: 'title-price' };
  }

  return null;
}

function toRef(listing: NormalizedListing, match: Match | null): DuplicateListingRef {
  return {
    source: listing.source,
    listingUrl: listing.listingUrl,
    title: listing.title,
    price: listing.price,
    currency: listing.currency,
    imageUrl: listing.imageUrl,
    location: listing.location,
    matchScore: match ? Math.round(match.score * 1000) / 1000 : undefined,
    matchReason: match?.reason,
  };
}

/** Cheapest priced listing first; unpriced listings sort last. Ties keep order. */
function pickPrimary(indices: number[], listings: NormalizedListing[]): number {
  let best = indices[0];
  for (const i of indices) {
    const a = listings[i];
    const b = listings[best];
    if (a.price == null) continue;
    if (b.price == null || a.price < b.price) best = i;
  }
  return best;
}

/**
 * Group listings that represent the same item. Each group carries a primary
 * (cheapest) listing and the remaining cross-listings, enriched with the match
 * strength so the UI can explain why they were paired.
 */
export function groupDuplicates(listings: NormalizedListing[]): DuplicateGroup[] {
  const prepped: Prepped[] = listings.map((listing) => ({
    listing,
    tokens: titleTokens(listing.title),
    url: canonicalUrl(listing.listingUrl),
    image: imageKey(listing.imageUrl),
  }));

  const parent = prepped.map((_, i) => i);
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    while (parent[x] !== root) {
      const next = parent[x];
      parent[x] = root;
      x = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const pairMatch = new Map<string, Match>();
  for (let i = 0; i < prepped.length; i += 1) {
    for (let j = i + 1; j < prepped.length; j += 1) {
      const match = matchScore(prepped[i], prepped[j]);
      if (match) {
        union(i, j);
        pairMatch.set(`${i}:${j}`, match);
      }
    }
  }

  const components = new Map<number, number[]>();
  for (let i = 0; i < prepped.length; i += 1) {
    const root = find(i);
    const bucket = components.get(root);
    if (bucket) bucket.push(i);
    else components.set(root, [i]);
  }

  const groups: DuplicateGroup[] = [];
  for (const indices of components.values()) {
    const primaryIndex = pickPrimary(indices, listings);
    const others: NormalizedListing[] = [];
    for (const i of indices) {
      if (i === primaryIndex) continue;
      const lo = Math.min(i, primaryIndex);
      const hi = Math.max(i, primaryIndex);
      const match = pairMatch.get(`${lo}:${hi}`) ?? null;
      others.push(listings[i]);
      const ref = toRef(listings[i], match);
      const primary = listings[primaryIndex];
      primary.duplicateListings = primary.duplicateListings ?? [];
      primary.duplicateListings.push(ref);
    }
    if (others.length) {
      listings[primaryIndex].duplicateCount = others.length;
    }
    groups.push({ primary: listings[primaryIndex], others });
  }
  return groups;
}
