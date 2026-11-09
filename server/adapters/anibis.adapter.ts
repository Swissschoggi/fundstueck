import type { ScraperConfig } from '../config.js';
import { SmgAdapter, smgListingUrl } from './smg.adapter.js';

const SITE = 'https://www.anibis.ch';

/** Anibis.ch — French-language Swiss classifieds (SMG platform, Romandie). */
export function createAnibisAdapter(cfg: ScraperConfig): SmgAdapter {
  return new SmgAdapter({
    id: 'anibis',
    label: 'Anibis.ch',
    locale: 'fr',
    searchBaseUrl: `${SITE}/fr/q`,
    siteBaseUrl: SITE,
    icon: 'storefront',
    description:
      'Reads the public, server-rendered Anibis search page (French locale, ' +
      'Romandie) and normalises the embedded Next.js payload. Rate-limited and ' +
      'cached; no /api/ calls, no login, no CAPTCHA solving.',
    docsUrl: `${SITE}/fr/q?query=velo`,
    envVar: 'ENABLE_ANIBIS_ADAPTER',
    enabled: cfg.anibis,
    capabilities: [
      'Public web search',
      'French / Romandie',
      'Server-rendered JSON',
      'Rate-limited + cached',
      'CHF prices',
    ],
    listingUrl: (node, id) => smgListingUrl(SITE, 'fr', node, id),
    userAgent: cfg.userAgent,
    minIntervalMs: cfg.minIntervalMs,
  });
}
