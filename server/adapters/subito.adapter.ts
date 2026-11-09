import type { ScraperConfig } from '../config.js';
import type { NormalizedListing } from '../core/types.js';
import { PublicPageAdapter } from './public-page.adapter.js';
import { asArray, asRecord, extractNextData, str, type JsonObject } from './scrape.js';

const SITE = 'https://www.subito.it';

/** Subito.it — Italian classifieds; public server-rendered search page. */
export function createSubitoAdapter(cfg: ScraperConfig): PublicPageAdapter {
  return new PublicPageAdapter({
    id: 'subito',
    label: 'Subito.it',
    markets: ['IT'],
    currency: 'EUR',
    icon: 'storefront',
    description:
      'Reads the public, server-rendered Subito search page and normalises the embedded ' +
      'initial-state listings. Rate-limited and cached; no /api/ calls, no login, no ' +
      'CAPTCHA solving.',
    docsUrl: `${SITE}/annunci-italia/vendita/usato/?q=velo`,
    envVar: 'ENABLE_REGIONAL_ADAPTERS',
    enabled: cfg.regional,
    capabilities: [
      'Public web search',
      'Server-rendered JSON',
      'Rate-limited + cached',
      'EUR prices',
      'Italian regions',
    ],
    acceptLanguage: 'it-IT,it;q=0.9,en;q=0.6',
    userAgent: cfg.userAgent,
    minIntervalMs: cfg.minIntervalMs,
    searchUrl: (query) =>
      `${SITE}/annunci-italia/vendita/usato/?q=${encodeURIComponent(query)}`,
    parse,
  });
}

function parse(html: string, fetchedAt: string): NormalizedListing[] {
  const next = extractNextData(html, 'Subito.it');
  const pageProps = asRecord(asRecord(asRecord(next)?.['props'])?.['pageProps']);
  const state = asRecord(pageProps?.['initialState']);
  const items = asArray(asRecord(state?.['items'])?.['originalList']);

  return items
    .map(asRecord)
    .filter((item): item is JsonObject => item != null)
    .map((item) => normalize(item, fetchedAt))
    .filter((listing): listing is NormalizedListing => listing != null);
}

function normalize(item: JsonObject, fetchedAt: string): NormalizedListing | null {
  const urn = str(item['urn']);
  const id = urn?.split(':').pop();
  const title = str(item['subject']);
  const url = str(asRecord(item['urls'])?.['default']);
  if (!id || !title || !url) return null;

  const features = asRecord(item['features']);
  const priceFeature = asRecord(features?.['/price']);
  const rawPrice = str(asRecord(asArray(priceFeature?.['values'])[0])?.['key']);
  const price = rawPrice != null ? Number(rawPrice) : null;

  const geo = asRecord(item['geo']);
  const location =
    str(asRecord(geo?.['town'])?.['value']) ??
    str(asRecord(geo?.['city'])?.['value']) ??
    null;

  const image = asRecord(asArray(item['images'])[0]);
  const imageUrl = str(image?.['cdnBaseUrl']) ?? null;

  const published = str(item['date']);

  return {
    id: `subito:${id}`,
    source: 'subito',
    sourceListingId: id,
    title,
    description: str(item['body']) ?? '',
    price: price != null && Number.isFinite(price) ? price : null,
    currency: 'EUR',
    location,
    imageUrl,
    listingUrl: url,
    publishedAt: published && !Number.isNaN(Date.parse(published)) ? published : null,
    fetchedAt,
  };
}
