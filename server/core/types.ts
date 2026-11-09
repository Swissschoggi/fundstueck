/**
 * Shared, marketplace-agnostic listing model.
 * All optional enrichment fields are produced by the shared search pipeline.
 */
export interface NormalizedLocation {
  raw: string;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface DuplicateListingRef { source: string; listingUrl: string }

export interface NormalizedListing {
  id: string;
  source: string;
  sourceListingId: string;
  title: string;
  description: string;
  price: number | null;
  currency: string;
  marketPrice?: number | null;
  marketCurrency?: string;
  fxRate?: number | null;
  location: string | null;
  normalizedLocation?: NormalizedLocation | null;
  imageUrl: string | null;
  listingUrl: string;
  publishedAt: string | null;
  fetchedAt: string;
  relevanceScore?: number;
  freshness?: 'fresh' | 'aging' | 'stale' | 'unknown';
  ageDays?: number | null;
  duplicateCount?: number;
  duplicateListings?: DuplicateListingRef[];
  gender?: 'male' | 'female' | 'unisex' | null;
  size?: string | null;
}

export type AdapterMode = 'live' | 'sample';
export interface AdapterSearchParams { q: string; limit: number; market?: string; category?: string; gender?: string; size?: string }

export class SourceError extends Error {
  constructor(message: string, readonly code: 'AUTH' | 'UPSTREAM' | 'NETWORK' | 'RESPONSE', readonly statusCode?: number) {
    super(message); this.name = 'SourceError';
  }
}

export interface AdapterHealth { ok: boolean; latencyMs: number; message: string }
export interface AdapterConfigField { key: string; label: string; secret?: boolean; placeholder?: string; default?: string; help?: string }
export interface AdapterCapabilities {
  search: boolean; pagination: boolean; detail: boolean; categories: boolean; locationFilter: boolean;
  conditionFilter: boolean; priceFilter: boolean; sort: boolean; images: boolean; sellerInfo: boolean; publishedDate: boolean;
}

export interface MarketplaceAdapter {
  readonly id: string; readonly label: string; readonly mode: AdapterMode; readonly description: string;
  readonly auth: string; readonly envVars: string[]; readonly capabilities: string[]; readonly icon: string;
  readonly markets: string[]; readonly docsUrl?: string; readonly configFields?: AdapterConfigField[];
  readonly adapterCapabilities?: AdapterCapabilities;
  isEnabled(): boolean; disabledReason(): string | null; healthCheck(): Promise<AdapterHealth>;
  search(params: AdapterSearchParams): Promise<NormalizedListing[]>;
  getListing?(id: string): Promise<NormalizedListing | null>;
  listCategories?(): Promise<Array<{ id: string; label: string }>>;
  searchPage?(params: AdapterSearchParams, page: number): Promise<NormalizedListing[]>;
}

export interface AdapterInfo {
  source: string; label: string; mode: AdapterMode; icon: string; description: string; auth: string;
  envVars: string[]; capabilities: string[]; markets: string[]; docsUrl?: string; configFields?: AdapterConfigField[];
  origin: 'built-in' | 'custom' | 'plugin'; configured: boolean; enabled: boolean; runtimeDisabled: boolean; disabledReason: string | null;
}

export const SORTS = ['best', 'newest', 'price_asc', 'price_desc'] as const;
export type SortKey = (typeof SORTS)[number];

export interface SourceStatus {
  source: string; label: string; mode: AdapterMode; enabled: boolean; disabledReason: string | null;
  status?: 'ok' | 'error' | 'timeout'; count?: number; latencyMs?: number; error?: string;
}

export interface SearchResponse {
  query: string; normalizedQuery?: string; market: string; marketCurrency?: string; sort: SortKey;
  total: number; rawTotal?: number; duplicatesRemoved?: number; tookMs: number; isSampleData: boolean;
  listings: NormalizedListing[]; sources: SourceStatus[];
}
