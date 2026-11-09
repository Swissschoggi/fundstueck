/**
 * Shared, marketplace-agnostic listing model.
 *
 * Every source adapter normalizes its marketplace-specific response into
 * this shape. The frontend and the search API only ever see NormalizedListing
 * — never a marketplace-native payload.
 */
export interface NormalizedListing {
  /** Stable unique id: `${source}:${sourceListingId}`. */
  id: string;
  /** Adapter id, e.g. "ebay" | "sample". */
  source: string;
  /** The marketplace's own id for this listing. */
  sourceListingId: string;
  title: string;
  description: string;
  /** Price in the listing's currency minor-neutral units (e.g. 450.0 CHF). Null when unknown. */
  price: number | null;
  /** ISO 4217 currency code, e.g. "CHF". */
  currency: string;
  /** Human-readable location, e.g. "Zürich 8005". Null when unknown. */
  location: string | null;
  /** Absolute image URL, null when the source has none. */
  imageUrl: string | null;
  /** Absolute URL back to the original marketplace listing. */
  listingUrl: string;
  /** ISO-8601 publication time, null when the source does not expose it. */
  publishedAt: string | null;
  /** ISO-8601 time when Fundstück fetched this listing. */
  fetchedAt: string;
}

export type AdapterMode = 'live' | 'sample';

export interface AdapterSearchParams {
  q: string;
  limit: number;
  /** Buyer market code for adapters that can target several markets. */
  market?: string;
}

/** Thrown by adapters on upstream/auth/network failure. Message must be safe to surface. */
export class SourceError extends Error {
  constructor(
    message: string,
    readonly code: 'AUTH' | 'UPSTREAM' | 'NETWORK' | 'RESPONSE',
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'SourceError';
  }
}

export interface AdapterHealth {
  ok: boolean;
  latencyMs: number;
  message: string;
}

/**
 * A marketplace source adapter. Implementations must be self-contained:
 * credentials via Config, timeouts on every request, and SourceError on
 * failure so one broken source never breaks a search.
 */
export interface MarketplaceAdapter {
  /** Stable machine id, e.g. "ebay". */
  readonly id: string;
  /** Human label, e.g. "eBay.ch". */
  readonly label: string;
  /** "live" calls the real marketplace; "sample" returns representative dev data. */
  readonly mode: AdapterMode;
  /** One-paragraph explanation shown on the settings page. */
  readonly description: string;
  /** Short access-method label, e.g. "Official Browse API". */
  readonly auth: string;
  /** Environment variables that configure this adapter (never secret values). */
  readonly envVars: string[];
  /** Capability tags shown on the settings page. */
  readonly capabilities: string[];
  /** Material Symbols icon name for the settings card. */
  readonly icon: string;
  /** Market codes this adapter can serve, e.g. ["CH"] or ["US","GB"]. */
  readonly markets: string[];
  /** Optional link to the official API documentation. */
  readonly docsUrl?: string;
  /** True when credentials/configuration are present (ignores runtime toggles). */
  isEnabled(): boolean;
  /** Reason the adapter is unconfigured, null when configured. */
  disabledReason(): string | null;
  /** Lightweight, non-destructive probe used by the settings page. Never throws. */
  healthCheck(): Promise<AdapterHealth>;
  search(params: AdapterSearchParams): Promise<NormalizedListing[]>;
}

/** Adapter state exposed by the settings API. */
export interface AdapterInfo {
  source: string;
  label: string;
  mode: AdapterMode;
  icon: string;
  description: string;
  auth: string;
  envVars: string[];
  capabilities: string[];
  markets: string[];
  docsUrl?: string;
  /** Where this adapter came from: shipped, operator-defined or a plugin. */
  origin: 'built-in' | 'custom' | 'plugin';
  /** Credentials/config present. */
  configured: boolean;
  /** Effectively used by search (configured and not runtime-disabled). */
  enabled: boolean;
  /** True when the operator toggled this adapter off at runtime. */
  runtimeDisabled: boolean;
  disabledReason: string | null;
}

export const SORTS = ['best', 'newest', 'price_asc', 'price_desc'] as const;
export type SortKey = (typeof SORTS)[number];

export interface SourceStatus {
  source: string;
  label: string;
  mode: AdapterMode;
  enabled: boolean;
  disabledReason: string | null;
  /** Present after a search: outcome for this source in that search. */
  status?: 'ok' | 'error';
  count?: number;
  latencyMs?: number;
  error?: string;
}

export interface SearchResponse {
  query: string;
  /** Market code the search was scoped to, e.g. "CH". */
  market: string;
  sort: SortKey;
  total: number;
  tookMs: number;
  /** True when every result came from a sample adapter (never mixed with live data silently). */
  isSampleData: boolean;
  listings: NormalizedListing[];
  sources: SourceStatus[];
}
