import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Registry data ships with the server (committed JSON).
const REGISTRY_DIR = path.resolve(__dirname, '../registry');

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

export interface RegistryCountryMarketplace {
  country_code: string;
  marketplace_id: string;
  priority: number;
  notes: string;
}

export interface RegistryVersion {
  version: string;
  generated: string;
}

function readJson<T>(name: string): T {
  const file = path.join(REGISTRY_DIR, name);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

let countriesCache: RegistryCountry[] | null = null;
let marketplacesCache: RegistryMarketplace[] | null = null;
let mappingsCache: RegistryCountryMarketplace[] | null = null;

export function listCountries(): RegistryCountry[] {
  if (!countriesCache) countriesCache = readJson<RegistryCountry[]>('countries.json');
  return countriesCache;
}

export function getCountry(code: string): RegistryCountry | undefined {
  return listCountries().find((c) => c.code === code.toUpperCase());
}

export function listMarketplaces(): RegistryMarketplace[] {
  if (!marketplacesCache) marketplacesCache = readJson<RegistryMarketplace[]>('marketplaces.json');
  return marketplacesCache;
}

export function getMarketplace(id: string): RegistryMarketplace | undefined {
  return listMarketplaces().find((m) => m.id === id);
}

export function countryMarketplaces(code: string): RegistryMarketplace[] {
  if (!mappingsCache) mappingsCache = readJson<RegistryCountryMarketplace[]>('country_marketplaces.json');
  const ids = mappingsCache
    .filter((m) => m.country_code === code.toUpperCase())
    .sort((a, b) => a.priority - b.priority)
    .map((m) => m.marketplace_id);
  const mp = listMarketplaces();
  const out: RegistryMarketplace[] = [];
  for (const id of ids) {
    const m = mp.find((x) => x.id === id);
    if (m) out.push(m);
  }
  return out;
}

export function countryMarketplaceMappings(code: string): RegistryCountryMarketplace[] {
  if (!mappingsCache) mappingsCache = readJson<RegistryCountryMarketplace[]>('country_marketplaces.json');
  return mappingsCache.filter((m) => m.country_code === code.toUpperCase()).sort((a, b) => a.priority - b.priority);
}

export function registryVersion(): RegistryVersion {
  try {
    return readJson<RegistryVersion>('version.json');
  } catch {
    return { version: 'unknown', generated: '' };
  }
}

export function reloadRegistry(): void {
  countriesCache = null;
  marketplacesCache = null;
  mappingsCache = null;
}

// ---- User preferences (enabled sources per country) ----
import { readSetupRegion } from './regions.js';

export function enabledSourcesFile(dataDir: string): string {
  return path.join(dataDir, 'enabled-sources.json');
}

export function readEnabledSources(dataDir: string): Record<string, string[]> {
  try {
    return JSON.parse(fs.readFileSync(enabledSourcesFile(dataDir), 'utf8'));
  } catch {
    return {};
  }
}

export function writeEnabledSources(dataDir: string, prefs: Record<string, string[]>): void {
  const file = enabledSourcesFile(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(prefs, null, 2));
}

export function enabledForCountry(dataDir: string, code: string): string[] {
  const prefs = readEnabledSources(dataDir);
  if (prefs[code]) return prefs[code];
  // default: enable implemented/available ones that are not restricted
  const cms = countryMarketplaces(code);
  // A parser existing in the codebase is not permission to run it.
  // Auto-enable only sources with an implemented adapter AND an explicit
  // authorization assessment. Unknown/permission-required sources stay off.
  return cms
    .filter((m) => m.adapter_status === 'implemented')
    .filter((m) => m.automation_permission === 'authorized')
    .map((m) => m.id);
}
