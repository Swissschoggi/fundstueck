import fs from 'node:fs';
import path from 'node:path';
import type { ServerConfig } from '../config.js';
import { DEFAULT_MARKET, findMarket } from './markets.js';
import { createAnibisAdapter } from '../adapters/anibis.adapter.js';
import { createDevintaAdapter } from '../adapters/devinta.adapter.js';
import { EbayAdapter } from '../adapters/ebay.adapter.js';
import { createDepopAdapter } from '../adapters/depop.adapter.js';
import { createKijijiAdapter } from '../adapters/kijiji.adapter.js';
import { createKleinanzeigenAdapter } from '../adapters/kleinanzeigen.adapter.js';
import { JsonLdAdapter } from '../adapters/jsonld.adapter.js';
import { createMarkoAdapter } from '../adapters/marko.adapter.js';
import { SampleAdapter } from '../adapters/sample.adapter.js';
import { createSubitoAdapter } from '../adapters/subito.adapter.js';
import { createTuttiAdapter } from '../adapters/tutti.adapter.js';
import { createWillhabenAdapter } from '../adapters/willhaben.adapter.js';
import { logEvent } from './events.js';
import { initAdapterConfig, getAdapterConfig, setAdapterConfig } from './adapter-config.js';
import type { AdapterHealth, AdapterInfo, MarketplaceAdapter } from './types.js';
import {
  createCustomAdapter,
  loadCustomSources,
  type CustomSourceConfig,
} from './custom-sources.js';
import { loadPlugins, type PluginStatus } from './plugins.js';
import {
  readSetupCountries,
  resolveSetup,
  saveSetupRegion,
  type SetupState,
} from './regions.js';

let builtInAdapters: MarketplaceAdapter[] = [];
let dynamicAdapters: MarketplaceAdapter[] = [];
let allAdapters: MarketplaceAdapter[] = [];
let customSources: CustomSourceConfig[] = [];
let pluginStatuses: PluginStatus[] = [];
let runtimeDisabled = new Set<string>();
let settingsFile: string | null = null;
let defaultMarket = DEFAULT_MARKET;
let serverCfg: ServerConfig | null = null;
let regionCode = DEFAULT_MARKET;
let selectedCountries: string[] = [DEFAULT_MARKET];
let setupComplete = false;

interface PersistedSettings {
  disabledSources: string[];
}

/**
 * Adapter registry: one independent adapter per marketplace source.
 * Runtime enable/disable overrides are persisted to DATA_DIR so operator
 * choices survive restarts (credentials themselves stay in env only).
 *
 * Only adapters for the chosen region are instantiated; switching region in
 * onboarding re-builds this set.
 */
export async function initRegistry(cfg: ServerConfig): Promise<MarketplaceAdapter[]> {
  serverCfg = cfg;
  settingsFile = path.join(cfg.dataDir, 'adapter-settings.json');
  loadSettings();
  initAdapterConfig(cfg);

  const setup = resolveSetup(cfg);
  setupComplete = setup.complete;
  regionCode = setup.region;
  defaultMarket = setup.region;
  selectedCountries = setup.countries?.length ? setup.countries : [setup.region];

  rebuildBuiltIns();
  await refreshDynamicAdapters();

  logEvent(
    'registry',
    'info',
    `Adapter registry initialised for ${regionCode} (${builtInAdapters.length} built-in, ${dynamicAdapters.length} optional adapters).`,
  );
  if (!setupComplete) {
    logEvent('setup', 'info', 'First run: waiting for the operator to choose a region.');
  }
  for (const a of builtInAdapters) {
    logEvent(
      a.id,
      a.isEnabled() ? 'ok' : 'info',
      a.isEnabled() ? `Configured (${a.mode}).` : `Unconfigured: ${a.disabledReason()}`,
    );
  }
  for (const cfgSource of customSources) {
    logEvent(
      cfgSource.id,
      'info',
      `Custom ${cfgSource.type} source configured (${cfgSource.markets.join(', ')}).`,
    );
  }
  return allAdapters;
}

function rebuildBuiltIns(): void {
  const cfg = serverCfg;
  if (!cfg) return;
  const candidates: MarketplaceAdapter[] = [
    new EbayAdapter(cfg.ebay),
    createTuttiAdapter(cfg.scrapers),
    createAnibisAdapter(cfg.scrapers),
    createMarkoAdapter(cfg.scrapers),
    createDepopAdapter(cfg.scrapers),
    createDevintaAdapter('marktplaats', cfg.scrapers),
    createDevintaAdapter('2dehands', cfg.scrapers),
    createSubitoAdapter(cfg.scrapers),
    createWillhabenAdapter(cfg.scrapers),
    createKijijiAdapter(cfg.scrapers),
    createKleinanzeigenAdapter(cfg.scrapers),
    new JsonLdAdapter({
      id: 'tori',
      label: 'Tori.fi',
      markets: ['FI'],
      currency: 'EUR',
      icon: 'search',
      description: 'Finnish classifieds via JSON-LD structured data.',
      docsUrl: 'https://www.tori.fi/recommerce/forsale/search?query=iphone',
      envVar: 'ENABLE_TORI_ADAPTER',
      enabled: cfg.scrapers.regional !== false,
      capabilities: ['Public web search', 'JSON-LD structured data'],
      acceptLanguage: 'fi-FI,fi;q=0.9',
      userAgent: cfg.scrapers.userAgent,
      minIntervalMs: cfg.scrapers.minIntervalMs,
      searchUrl: (q) => `https://www.tori.fi/recommerce/forsale/search?q=${encodeURIComponent(q)}`,
    }),
    new SampleAdapter(cfg.enableSampleAdapter),
  ];
  builtInAdapters = candidates.filter((adapter) => adapter.markets.some((m) => selectedCountries.includes(m)));
}

/**
 * Rebuild custom + plugin adapters from disk. Called at boot and whenever
 * the operator changes custom sources or reloads plugins.
 */
export async function refreshDynamicAdapters(): Promise<void> {
  if (!serverCfg) return;
  const cfg = serverCfg;
  customSources = loadCustomSources(cfg);
  const reserved = new Set(builtInAdapters.map((a) => a.id));
  const customAdapters: MarketplaceAdapter[] = [];

  for (const source of customSources) {
    if (reserved.has(source.id)) {
      logEvent(
        'settings',
        'error',
        `Custom source "${source.id}" collides with an existing adapter — skipped.`,
      );
      continue;
    }
    try {
      customAdapters.push(createCustomAdapter(source));
      reserved.add(source.id);
    } catch (err) {
      logEvent(
        'settings',
        'error',
        `Custom source "${source.id}" could not be created: ${(err as Error).message}`,
      );
    }
  }

  const { adapters: pluginAdapters, statuses } = await loadPlugins(cfg, reserved);
  pluginStatuses = statuses;
  dynamicAdapters = [...customAdapters, ...pluginAdapters];
  allAdapters = [...builtInAdapters, ...dynamicAdapters];

  // Drop persisted runtime toggles for adapters that no longer exist.
  const known = new Set(allAdapters.map((a) => a.id));
  let pruned = false;
  for (const id of runtimeDisabled) {
    if (!known.has(id)) {
      runtimeDisabled.delete(id);
      pruned = true;
    }
  }
  if (pruned) persistSettings();
}

/** Complete first-run setup (or change region) and re-install its sources. */
export async function setRegion(region: string, countries?: string[]): Promise<void> {
  if (!serverCfg) throw new Error('Registry is not initialised.');
  const market = findMarket(region);
  if (!market) throw new Error(`Unknown region ${region}`);
  const codes = (countries && countries.length ? countries : [market.code])
    .map((c) => findMarket(c)?.code)
    .filter((c): c is string => Boolean(c));
  if (codes.length === 0) codes.push(market.code);

  saveSetupRegion(serverCfg, market.code, codes);
  regionCode = market.code;
  defaultMarket = market.code;
  selectedCountries = codes;
  setupComplete = true;

  rebuildBuiltIns();
  await refreshDynamicAdapters();
  logEvent(
    'setup',
    'ok',
    `Region set to ${market.label} (${market.code}); ${builtInAdapters.length} built-in sources installed.`,
  );
}

export function getSetupState(): SetupState {
  const countries = readSetupCountries(serverCfg!);
  return { complete: setupComplete, region: regionCode, countries: countries.length ? countries : [regionCode] };
}

export function isSetupComplete(): boolean {
  return setupComplete;
}

export function getRegion(): string {
  return regionCode;
}

export function getSelectedCountries(): string[] {
  return [...selectedCountries];
}

export function getCustomSources(): CustomSourceConfig[] {
  return customSources.map((s) => ({ ...s }));
}

export function getPluginStatuses(): PluginStatus[] {
  return pluginStatuses.map((p) => ({ ...p, adapterIds: [...p.adapterIds] }));
}

export function getPluginsDir(): string {
  return serverCfg?.pluginsDir ?? '';
}

export function getReservedSourceIds(): Set<string> {
  return new Set(allAdapters.map((a) => a.id));
}

export function getAdapters(): MarketplaceAdapter[] {
  return allAdapters;
}

export function getDefaultMarket(): string {
  return defaultMarket;
}

export function isEffectivelyEnabled(adapter: MarketplaceAdapter): boolean {
  return adapter.isEnabled() && !runtimeDisabled.has(adapter.id);
}

/** Enabled adapters, optionally scoped to a market code (e.g. "CH", "US"). */
export function enabledAdapters(market?: string): MarketplaceAdapter[] {
  return allAdapters.filter(
    (adapter) =>
      isEffectivelyEnabled(adapter) && (market == null || adapter.markets.includes(market)),
  );
}

export function describeAdapter(adapter: MarketplaceAdapter): AdapterInfo {
  const configured = adapter.isEnabled();
  const runtimeOff = runtimeDisabled.has(adapter.id);
  return {
    source: adapter.id,
    label: adapter.label,
    mode: adapter.mode,
    icon: adapter.icon,
    description: adapter.description,
    auth: adapter.auth,
    envVars: [...adapter.envVars],
    capabilities: [...adapter.capabilities],
    markets: [...adapter.markets],
    docsUrl: adapter.docsUrl,
    configFields: adapter.configFields,
    origin: builtInAdapters.some((a) => a.id === adapter.id)
      ? 'built-in'
      : customSources.some((s) => s.id === adapter.id)
        ? 'custom'
        : 'plugin',
    configured,
    enabled: configured && !runtimeOff,
    runtimeDisabled: runtimeOff,
    disabledReason: adapter.disabledReason(),
  };
}

export function setAdapterEnabled(id: string, enabled: boolean): AdapterInfo | null {
  const adapter = allAdapters.find((a) => a.id === id);
  if (!adapter) return null;
  if (enabled) runtimeDisabled.delete(id);
  else runtimeDisabled.add(id);
  persistSettings();
  logEvent(
    adapter.id,
    'info',
    enabled ? 'Adapter enabled at runtime by operator.' : 'Adapter disabled at runtime by operator.',
  );
  return describeAdapter(adapter);
}

export async function runHealthCheck(id: string): Promise<AdapterHealth | null> {
  const adapter = allAdapters.find((a) => a.id === id);
  if (!adapter) return null;
  const health = await adapter.healthCheck();
  logEvent(
    adapter.id,
    health.ok ? 'ok' : 'error',
    `Health check ${health.ok ? 'healthy' : 'failed'} (${health.latencyMs}ms) — ${health.message}`,
  );
  return health;
}

function loadSettings(): void {
  runtimeDisabled = new Set();
  if (!settingsFile) return;
  try {
    const raw = fs.readFileSync(settingsFile, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    const ids = Array.isArray(parsed.disabledSources) ? parsed.disabledSources : [];
    runtimeDisabled = new Set(ids.filter((id): id is string => typeof id === 'string'));
  } catch {
    /* no settings yet — all configured adapters stay enabled */
  }
}

function persistSettings(): void {
  if (!settingsFile) return;
  try {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(
      settingsFile,
      JSON.stringify({ disabledSources: [...runtimeDisabled] }, null, 2),
    );
  } catch (err) {
    logEvent('settings', 'error', `Could not persist adapter settings: ${(err as Error).message}`);
  }
}


/** Read the persisted operator config for an adapter (UI-editable tokens, etc.). */
export function getAdapterConfigValues(id: string): Record<string, string> {
  return getAdapterConfig(id);
}

/** Persist operator config for an adapter. */
export function setAdapterConfigValues(id: string, values: Record<string, string>): void {
  setAdapterConfig(id, values);
}
