import type { ScraperConfig } from '../config.js';
import type { NormalizedListing } from '../core/types.js';
import { PublicPageAdapter } from './public-page.adapter.js';
import { asArray, asRecord, extractNextData, str, type JsonObject } from './scrape.js';
import { parseGermanPrice } from './html.js';

const SITE = 'https://www.willhaben.at';

/** Willhaben.at — Austrian classifieds; public server-rendered search page. */
export function createWillhabenAdapter(cfg: ScraperConfig): PublicPageAdapter {
  return new PublicPageAdapter({
    id: 'willhaben',
    label: 'Willhaben.at',
    markets: ['AT'],
    currency: 'EUR',
    icon: 'storefront',
    description:
      'Reads the public, server-rendered Willhaben search page and normalises the ' +
      'advert summary payload. Rate-limited and cached; no /api/ calls, no login, no ' +
      'CAPTCHA solving.',
    docsUrl: `${SITE}/iad/kaufen-und-verkaufen/marktplatz?keyword=velo`,
    envVar: 'ENABLE_REGIONAL_ADAPTERS',
    enabled: cfg.regional,
    capabilities: [
      'Public web search',
      'Server-rendered JSON',
      'Rate-limited + cached',
      'EUR prices',
      'Austrian states',
    ],
    acceptLanguage: 'de-AT,de;q=0.9,en;q=0.6',
    userAgent: cfg.userAgent,
    minIntervalMs: cfg.minIntervalMs,
    searchUrl: (query) =>
      `${SITE}/iad/kaufen-und-verkaufen/marktplatz?keyword=${encodeURIComponent(query)}`,
    parse,
  });
}

function parse(html: string, fetchedAt: string): NormalizedListing[] {
  const next = extractNextData(html, 'Willhaben.at');
  const pageProps = asRecord(asRecord(asRecord(next)?.['props'])?.['pageProps']);
  const result = asRecord(pageProps?.['searchResult']);
  const summary = asRecord(result?.['advertSummaryList']);
  const ads = asArray(summary?.['advertSummary']);

  return ads
    .map(asRecord)
    .filter((ad): ad is JsonObject => ad != null)
    .map((ad) => normalize(ad, fetchedAt))
    .filter((listing): listing is NormalizedListing => listing != null);
}

function attribute(ad: JsonObject, name: string): string | undefined {
  const attributes = asArray(asRecord(ad['attributes'])?.['attribute']).map(asRecord);
  const found = attributes.find((attr) => attr?.['name'] === name);
  return str(asArray(found?.['values'])[0]);
}

function normalize(ad: JsonObject, fetchedAt: string): NormalizedListing | null {
  const rawId = ad['id'];
  const id = typeof rawId === 'number' ? String(rawId) : str(rawId);
  const title = attribute(ad, 'HEADING');
  const seoUrl = attribute(ad, 'SEO_URL');
  if (!id || !title) return null;

  const rawPrice = attribute(ad, 'PRICE') ?? attribute(ad, 'PRICE/AMOUNT');
  const price = rawPrice != null ? parseGermanPrice(rawPrice) : null;

  const locationText =
    [attribute(ad, 'LOCATION'), attribute(ad, 'POSTCODE')].filter(Boolean).join(' ') || null;

  const image = asRecord(asArray(asRecord(ad['advertImageList'])?.['advertImage'])[0]);
  const imageUrl =
    str(image?.['thumbnailImageUrl']) ?? str(image?.['mainImageUrl']) ?? null;

  return {
    id: `willhaben:${id}`,
    source: 'willhaben',
    sourceListingId: id,
    title,
    description: attribute(ad, 'BODY_DYN') ?? '',
    price,
    currency: 'EUR',
    location: locationText,
    imageUrl,
    listingUrl: seoUrl ? `${SITE}/iad/${seoUrl.replace(/^\/+/, '')}` : `${SITE}/iad/object?adId=${id}`,
    publishedAt: attribute(ad, 'PUBLISHED_String') ?? null,
    fetchedAt,
  };
}
