/** Client-side mirror of the search API payload shapes. */
export interface NormalizedListing {
  id: string;
  source: string;
  sourceListingId: string;
  title: string;
  description: string;
  price: number | null;
  currency: string;
  location: string | null;
  imageUrl: string | null;
  listingUrl: string;
  publishedAt: string | null;
  fetchedAt: string;
  gender?: 'male' | 'female' | 'unisex' | null;
  size?: string | null;
  marketPrice?: number | null;
  marketCurrency?: string;
  fxRate?: number | null;
  normalizedLocation?: { raw: string; countryCode: string | null; region: string | null; city: string | null; postalCode: string | null; latitude: number | null; longitude: number | null } | null;
  relevanceScore?: number;
  freshness?: 'fresh' | 'aging' | 'stale' | 'unknown';
  ageDays?: number | null;
  duplicateCount?: number;
  duplicateListings?: Array<{ source: string; listingUrl: string }>;
}

export type SortKey = 'best' | 'newest' | 'price_asc' | 'price_desc';

export interface CategoryOption {
  value: string;
  label: string;
}
export type ViewMode = 'grid' | 'list';

export interface SourceStatus {
  source: string;
  label: string;
  mode: 'live' | 'sample';
  enabled: boolean;
  disabledReason: string | null;
  status?: 'ok' | 'error' | 'timeout';
  count?: number;
  latencyMs?: number;
  error?: string;
}

export interface SearchResponse {
  query: string;
  market: string;
  sort: SortKey;
  total: number;
  tookMs: number;
  normalizedQuery?: string;
  marketCurrency?: string;
  rawTotal?: number;
  duplicatesRemoved?: number;
  isSampleData: boolean;
  listings: NormalizedListing[];
  sources: SourceStatus[];
}

export interface SourceInfo {
  source: string;
  label: string;
  mode: 'live' | 'sample';
  enabled: boolean;
  disabledReason: string | null;
}

/** Full adapter state from /api/sources (superset of SourceInfo). */
export interface AdapterConfigField {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  default?: string;
  help?: string;
}

export interface AdapterInfo extends SourceInfo {
  icon: string;
  description: string;
  auth: string;
  envVars: string[];
  capabilities: string[];
  markets: string[];
  docsUrl?: string;
  configFields?: AdapterConfigField[];
  origin: 'built-in' | 'custom' | 'plugin';
  configured: boolean;
  runtimeDisabled: boolean;
}

export interface AdapterHealthResult {
  source: string;
  ok: boolean;
  latencyMs: number;
  message: string;
  checkedAt: string;
}

export interface ServerEvent {
  id: number;
  at: string;
  source: string;
  level: 'info' | 'ok' | 'error';
  message: string;
}

export interface MarketInfo {
  code: string;
  label: string;
  currency: string;
  locale: string;
  ebayMarketplaceId: string;
  sources: { total: number; enabled: number };
}

export interface MarketsResponse {
  default: string;
  region?: string;
  setupComplete?: boolean;
  markets: MarketInfo[];
}

export interface RegionSource {
  id: string;
  label: string;
  kind: 'live' | 'official' | 'recipe';
  note?: string;
}

export interface RegionPack {
  code: string;
  label: string;
  group: 'Europe' | 'Americas' | 'Oceania';
  currency: string;
  locale: string;
  blurb: string;
  note?: string;
  sources: RegionSource[];
}

export interface SetupResponse {
  complete: boolean;
  region: string;
  countries: string[];
  regions: RegionPack[];
}

export interface SystemInfo {
  node: string;
  platform: string;
  env: string;
  uptimeSec: number;
  rssMb: number;
  heapUsedMb: number;
  adapters: { total: number; configured: number; enabled: number };
}


/* ---- Optional sources: custom configs, plugins, catalog ---- */

export interface CustomFieldMap {
  id?: string;
  title?: string;
  price?: string;
  currency?: string;
  location?: string;
  image?: string;
  url?: string;
  description?: string;
  publishedAt?: string;
}

export interface CustomHttpOptions {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  apiKeyEnv?: string;
  responsePath?: string;
  fields: CustomFieldMap;
  priceFactor: number;
}

export interface CustomCommandOptions {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs: number;
  outputFile?: string;
  format: 'auto' | 'ricardo';
}

export interface CustomSourceConfig {
  id: string;
  label: string;
  description: string;
  markets: string[];
  enabled: boolean;
  icon: string;
  type: 'http-json' | 'command';
  http?: CustomHttpOptions;
  command?: CustomCommandOptions;
}

export type CustomSourceDraft = Omit<CustomSourceConfig, 'enabled'> & { enabled?: boolean };

export interface PluginStatus {
  id: string;
  label: string;
  description: string;
  icon: string;
  markets: string[];
  envVars: string[];
  docsUrl?: string;
  configFields?: AdapterConfigField[];
  dir: string;
  loaded: boolean;
  error?: string;
  adapterIds: string[];
}

export interface CatalogEntry {
  id: string;
  label: string;
  kind: 'custom-command' | 'custom-http' | 'built-in';
  icon: string;
  markets: string[];
  description: string;
  install: string;
  installCommand?: string[];
  docsUrl?: string;
  risk?: string;
  template?: CustomSourceDraft;
}

export interface PluginsResponse {
  plugins: PluginStatus[];
  customSources: CustomSourceConfig[];
  catalog: CatalogEntry[];
  pluginsDir: string;
  region: string;
  setupComplete: boolean;
}

export interface SourceTestResult {
  source: string;
  ok: boolean;
  latencyMs: number;
  count?: number;
  sample?: NormalizedListing[];
  error?: string;
}

/* ---- Marketplace registry (country-aware) ---- */

export interface RegistryCountry {
  code: string;
  name: string;
  flag: string;
  currency: string;
  languages: string[];
  default_locale: string;
  marketplace_ids: string[];
}

export interface RegistryMarketplace {
  id: string;
  name: string;
  domain: string | null;
  category_tags: string[];
  capability: string;
  technical_access: string;
  automation_permission: string;
  official_api_url: string | null;
  terms_url: string | null;
  robots_url: string | null;
  requires_credentials: boolean;
  requires_partner_approval: boolean;
  search_endpoint_available: boolean | null;
  listing_detail_endpoint_available: boolean | null;
  pagination_supported: boolean | null;
  price_available: boolean | null;
  currency_available: boolean | null;
  location_available: boolean | null;
  image_url_available: boolean | null;
  condition_available: boolean | null;
  published_date_available: boolean | null;
  last_verified_at: string | null;
  verification_notes: string;
  adapter_status: string;
}

export interface RegistryCountryMarketplace extends RegistryMarketplace {
  priority: number;
  country_notes: string;
}

export interface RegistryCountryResponse {
  country: RegistryCountry;
  marketplaces: RegistryCountryMarketplace[];
  enabled: string[];
}

export interface RegistryCountriesResponse {
  countries: RegistryCountry[];
}
