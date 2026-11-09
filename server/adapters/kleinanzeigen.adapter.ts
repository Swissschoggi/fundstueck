import type { ScraperConfig } from '../config.js';
import type { NormalizedListing } from '../core/types.js';
import { PublicPageAdapter } from './public-page.adapter.js';
import { firstMatch, parseGermanPrice, stripTags } from './html.js';

const SITE = 'https://www.kleinanzeigen.de';

/** Kleinanzeigen.de — German classifieds; public server-rendered listing cards. */
export function createKleinanzeigenAdapter(cfg: ScraperConfig): PublicPageAdapter {
  return new PublicPageAdapter({
    id: 'kleinanzeigen',
    label: 'Kleinanzeigen.de',
    markets: ['DE'],
    currency: 'EUR',
    icon: 'storefront',
    description:
      'Reads the public, server-rendered Kleinanzeigen search page and normalises the ' +
      'listing cards. Rate-limited and cached; no /api/ calls, no login, no CAPTCHA ' +
      'solving.',
    docsUrl: `${SITE}/s-suchanfrage.html?keywords=velo`,
    envVar: 'ENABLE_REGIONAL_ADAPTERS',
    enabled: cfg.regional,
    capabilities: [
      'Public web search',
      'Server-rendered HTML',
      'Rate-limited + cached',
      'EUR prices',
      'German locations',
    ],
    acceptLanguage: 'de-DE,de;q=0.9,en;q=0.6',
    userAgent: cfg.userAgent,
    minIntervalMs: cfg.minIntervalMs,
    searchUrl: (query) =>
      `${SITE}/s-suchanfrage.html?keywords=${encodeURIComponent(query)}`,
    parse,
  });
}

function parse(html: string, fetchedAt: string): NormalizedListing[] {
  const out: NormalizedListing[] = [];
  const pattern = /<article([^>]*)>([\s\S]*?)<\/article>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) != null) {
    const attrs = match[1];
    const block = match[2];
    if (!attrs.includes('data-adid=') || !attrs.includes('data-href=')) continue;
    const id = /data-adid="(\d+)"/.exec(attrs)?.[1];
    const href = /data-href="([^"]+)"/.exec(attrs)?.[1];
    if (!id || !href) continue;
    const listing = normalize(id, href, block, fetchedAt);
    if (listing) out.push(listing);
  }
  return out;
}

function normalize(
  id: string,
  href: string,
  block: string,
  fetchedAt: string,
): NormalizedListing | null {
  let title: string | undefined;
  let description = '';
  let imageUrl: string | null = null;

  const jsonLd = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(block);
  if (jsonLd) {
    try {
      const data = JSON.parse(jsonLd[1]) as Record<string, unknown>;
      if (typeof data.title === 'string') title = data.title.trim();
      if (typeof data.description === 'string') description = data.description.trim();
      if (typeof data.contentUrl === 'string') imageUrl = data.contentUrl;
    } catch {
      /* fall through to HTML selectors */
    }
  }

  title ??= firstMatch(block, /<h3[^>]*>([\s\S]*?)<\/h3>/);
  if (!title) return null;

  const priceText = firstMatch(block, />([\d.,]+\s*€)</);
  const price = priceText ? parseGermanPrice(priceText) : null;
  const location = firstMatch(block, /<span[^>]*>(\d{4,5}\s+[^<]+)<\/span>/) ?? null;
  if (!imageUrl) {
    imageUrl = /<img[^>]+src="([^"]+)"/.exec(block)?.[1] ?? null;
  }

  return {
    id: `kleinanzeigen:${id}`,
    source: 'kleinanzeigen',
    sourceListingId: id,
    title: stripTags(title),
    description,
    price,
    currency: 'EUR',
    location: location ? stripTags(location) : null,
    imageUrl,
    listingUrl: new URL(href, SITE).toString(),
    publishedAt: null,
    fetchedAt,
  };
}
