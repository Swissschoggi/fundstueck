import type { ScraperConfig } from '../config.js';
import { SmgAdapter, smgListingUrl } from './smg.adapter.js';

const SITE = 'https://www.tutti.ch';

/** Tutti.ch — German-language Swiss classifieds (SMG platform). */
export function createTuttiAdapter(cfg: ScraperConfig): SmgAdapter {
  return new SmgAdapter({
    id: 'tutti',
    label: 'Tutti.ch',
    locale: 'de',
    searchBaseUrl: `${SITE}/de/q`,
    siteBaseUrl: SITE,
    icon: 'storefront',
    description:
      'Reads the public, server-rendered Tutti search page (German locale) and ' +
      'normalises the embedded Next.js payload: title, price, canton/postcode, ' +
      'image and publish time. Rate-limited and cached; no /api/ calls, no login, ' +
      'no CAPTCHA solving.',
    docsUrl: `${SITE}/de/q?query=velo`,
    envVar: 'ENABLE_TUTTI_ADAPTER',
    enabled: cfg.tutti,
    capabilities: [
      'Public web search',
      'Server-rendered JSON',
      'Rate-limited + cached',
      'CHF prices',
      'Canton + postcode',
    ],
    listingUrl: (node, id) => smgListingUrl(SITE, 'de', node, id),
    userAgent: cfg.userAgent,
    minIntervalMs: cfg.minIntervalMs,
  });
}
