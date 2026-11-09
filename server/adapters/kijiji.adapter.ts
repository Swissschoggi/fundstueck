import type { ScraperConfig } from '../config.js';
import type { NormalizedListing } from '../core/types.js';
import { PublicPageAdapter } from './public-page.adapter.js';
import { asArray, asRecord, extractNextData, str, type JsonObject } from './scrape.js';

const SITE = 'https://www.kijiji.ca';

/** Kijiji.ca — Canadian classifieds; public server-rendered search page. */
export function createKijijiAdapter(cfg: ScraperConfig): PublicPageAdapter {
  return new PublicPageAdapter({
    id: 'kijiji',
    label: 'Kijiji.ca',
    markets: ['CA'],
    currency: 'CAD',
    icon: 'storefront',
    description:
      'Reads the public, server-rendered Kijiji search page and normalises the Apollo ' +
      'listing cache. Rate-limited and cached; no /api/ calls, no login, no CAPTCHA ' +
      'solving.',
    docsUrl: `${SITE}/b-search.html?formKeyword=velo`,
    envVar: 'ENABLE_REGIONAL_ADAPTERS',
    enabled: cfg.regional,
    capabilities: [
      'Public web search',
      'Server-rendered JSON',
      'Rate-limited + cached',
      'CAD prices',
      'Canadian cities',
    ],
    acceptLanguage: 'en-CA,en;q=0.9,fr;q=0.6',
    userAgent: cfg.userAgent,
    minIntervalMs: cfg.minIntervalMs,
    searchUrl: (query) => `${SITE}/b-search.html?formKeyword=${encodeURIComponent(query)}`,
    parse,
  });
}

function parse(html: string, fetchedAt: string): NormalizedListing[] {
  const next = extractNextData(html, 'Kijiji.ca');
  const pageProps = asRecord(asRecord(asRecord(next)?.['props'])?.['pageProps']);
  const apollo = asRecord(pageProps?.['__APOLLO_STATE__']);
  if (!apollo) return [];

  const seen = new Set<string>();
  const out: NormalizedListing[] = [];
  for (const [key, value] of Object.entries(apollo)) {
    if (!/^StandardListing:/.test(key)) continue;
    const ad = asRecord(value);
    if (!ad) continue;
    const listing = normalize(ad, fetchedAt);
    if (!listing || seen.has(listing.sourceListingId)) continue;
    seen.add(listing.sourceListingId);
    out.push(listing);
  }
  return out;
}

function normalize(ad: JsonObject, fetchedAt: string): NormalizedListing | null {
  const rawId = ad['id'];
  const id = typeof rawId === 'number' ? String(rawId) : str(rawId);
  const title = str(ad['title']);
  const url = str(ad['url']);
  if (!id || !title || !url) return null;

  const priceData = asRecord(ad['price']);
  const amount = priceData?.['amount'];
  const price = typeof amount === 'number' ? amount / 100 : null;

  const location = asRecord(ad['location']);
  const imageUrl = str(asArray(ad['imageUrls'])[0]) ?? null;
  const published = str(ad['activationDate']) ?? str(ad['sortingDate']);

  return {
    id: `kijiji:${id}`,
    source: 'kijiji',
    sourceListingId: id,
    title,
    description: str(ad['description']) ?? '',
    price,
    currency: 'CAD',
    location: str(location?.['name']) ?? str(location?.['address']) ?? null,
    imageUrl,
    listingUrl: url,
    publishedAt: published ?? null,
    fetchedAt,
  };
}
