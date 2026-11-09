import type { ScraperConfig } from '../config.js';
import type { NormalizedListing } from '../core/types.js';
import { PublicPageAdapter } from './public-page.adapter.js';
import { asArray, asRecord, extractNextData, str, type JsonObject } from './scrape.js';

type Site = 'marktplaats' | '2dehands';

const SITES: Record<Site, { origin: string; label: string; market: string; locale: string }> = {
  marktplaats: {
    origin: 'https://www.marktplaats.nl',
    label: 'Marktplaats',
    market: 'NL',
    locale: 'nl-NL',
  },
  '2dehands': {
    origin: 'https://www.2dehands.be',
    label: '2dehands',
    market: 'BE',
    locale: 'nl-BE',
  },
};

/** Marktplaats (NL) and 2dehands (BE) run the same Adevinta platform. */
export function createDevintaAdapter(site: Site, cfg: ScraperConfig): PublicPageAdapter {
  const meta = SITES[site];
  return new PublicPageAdapter({
    id: site,
    label: meta.label,
    markets: [meta.market],
    currency: 'EUR',
    icon: 'storefront',
    description:
      `Reads the public, server-rendered ${meta.label} search page and normalises the ` +
      'embedded Next.js listing payload. Rate-limited and cached; no /api/ calls, no ' +
      'login, no CAPTCHA solving.',
    docsUrl: `${meta.origin}/q/velo/`,
    envVar: 'ENABLE_REGIONAL_ADAPTERS',
    enabled: cfg.regional,
    capabilities: [
      'Public web search',
      'Server-rendered JSON',
      'Rate-limited + cached',
      'EUR prices',
      'Local pickup',
    ],
    acceptLanguage: `${meta.locale},${meta.locale.split('-')[0]};q=0.9,en;q=0.6`,
    userAgent: cfg.userAgent,
    minIntervalMs: cfg.minIntervalMs,
    searchUrl: (query) => `${meta.origin}/q/${encodeURIComponent(query)}/`,
    parse: (html, fetchedAt) => parse(html, fetchedAt, site, meta.origin),
  });
}

function parse(
  html: string,
  fetchedAt: string,
  source: Site,
  origin: string,
): NormalizedListing[] {
  const next = extractNextData(html, source);
  const pageProps = asRecord(asRecord(asRecord(next)?.['props'])?.['pageProps']);
  const response = asRecord(pageProps?.['searchRequestAndResponse']);
  const listings = asArray(response?.['listings']);

  return listings
    .map(asRecord)
    .filter((item): item is JsonObject => item != null)
    .map((item) => normalize(item, fetchedAt, source, origin))
    .filter((listing): listing is NormalizedListing => listing != null);
}

function normalize(
  item: JsonObject,
  fetchedAt: string,
  source: Site,
  origin: string,
): NormalizedListing | null {
  const rawId = item['itemId'];
  const id = typeof rawId === 'string' ? rawId : typeof rawId === 'number' ? String(rawId) : '';
  const title = str(item['title']);
  const relativeUrl = str(item['vipUrl']);
  if (!id || !title || !relativeUrl) return null;

  const priceInfo = asRecord(item['priceInfo']);
  const cents = priceInfo?.['priceCents'];
  const price = typeof cents === 'number' && Number.isFinite(cents) ? cents / 100 : null;

  const location = asRecord(item['location']);
  const locationText =
    [str(location?.['cityName']), str(location?.['countryName'])].filter(Boolean).join(' ') ||
    null;

  const pictures = asArray(item['pictures']).map(asRecord);
  const picture = pictures.find((p) => p != null);
  let imageUrl =
    str(picture?.['mediumUrl']) ??
    str(picture?.['largeUrl']) ??
    str(picture?.['extraLargeUrl']) ??
    str(picture?.['url']) ??
    str(asArray(item['imageUrls'])[0]) ??
    null;
  if (imageUrl?.startsWith('//')) imageUrl = `https:${imageUrl}`;

  return {
    id: `${source}:${id}`,
    source,
    sourceListingId: id,
    title,
    description: str(item['description']) ?? '',
    price,
    currency: 'EUR',
    location: locationText,
    imageUrl,
    listingUrl: new URL(relativeUrl, origin).toString(),
    publishedAt: null,
    fetchedAt,
  };
}
