/** Supported buyer markets. Market decides which adapters are queried. */
export interface MarketInfo {
  /** ISO 3166-1 alpha-2 country code. */
  code: string;
  label: string;
  /** Display/pricing currency for the market. */
  currency: string;
  /** BCP-47 locale used for marketplace context and formatting. */
  locale: string;
  /** eBay Browse API marketplace id for this country. */
  ebayMarketplaceId: string;
}

export const MARKETS: readonly MarketInfo[] = [
  { code: 'CH', label: 'Switzerland', currency: 'CHF', locale: 'de-CH', ebayMarketplaceId: 'EBAY_CH' },
  { code: 'US', label: 'United States', currency: 'USD', locale: 'en-US', ebayMarketplaceId: 'EBAY_US' },
  { code: 'GB', label: 'United Kingdom', currency: 'GBP', locale: 'en-GB', ebayMarketplaceId: 'EBAY_GB' },
  { code: 'DE', label: 'Germany', currency: 'EUR', locale: 'de-DE', ebayMarketplaceId: 'EBAY_DE' },
  { code: 'AT', label: 'Austria', currency: 'EUR', locale: 'de-AT', ebayMarketplaceId: 'EBAY_AT' },
  { code: 'FR', label: 'France', currency: 'EUR', locale: 'fr-FR', ebayMarketplaceId: 'EBAY_FR' },
  { code: 'IT', label: 'Italy', currency: 'EUR', locale: 'it-IT', ebayMarketplaceId: 'EBAY_IT' },
  { code: 'ES', label: 'Spain', currency: 'EUR', locale: 'es-ES', ebayMarketplaceId: 'EBAY_ES' },
  { code: 'NL', label: 'Netherlands', currency: 'EUR', locale: 'nl-NL', ebayMarketplaceId: 'EBAY_NL' },
  { code: 'BE', label: 'Belgium', currency: 'EUR', locale: 'nl-BE', ebayMarketplaceId: 'EBAY_BE' },
  { code: 'CA', label: 'Canada', currency: 'CAD', locale: 'en-CA', ebayMarketplaceId: 'EBAY_CA' },
  { code: 'AU', label: 'Australia', currency: 'AUD', locale: 'en-AU', ebayMarketplaceId: 'EBAY_AU' },
];

export const DEFAULT_MARKET = 'CH';

export function findMarket(code: string): MarketInfo | undefined {
  return MARKETS.find((m) => m.code === code.toUpperCase());
}

export function marketForEbayMarketplace(id: string): MarketInfo | undefined {
  return MARKETS.find((m) => m.ebayMarketplaceId === id.toUpperCase());
}
