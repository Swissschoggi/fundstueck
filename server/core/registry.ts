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
import { createMercariAdapter } from '../adapters/mercari.adapter.js';
import { createBlocketAdapter } from '../adapters/blocket.adapter.js';
import { createVintedAdapter } from '../adapters/vinted.adapter.js';
import { JsonLdAdapter } from '../adapters/jsonld.adapter.js';
import { createMarkoAdapter } from '../adapters/marko.adapter.js';
import { SampleAdapter } from '../adapters/sample.adapter.js';
import { createSubitoAdapter } from '../adapters/subito.adapter.js';
import { createTuttiAdapter } from '../adapters/tutti.adapter.js';
import { createWillhabenAdapter } from '../adapters/willhaben.adapter.js';
import { logEvent } from './events.js';
import { initStorage, readState, writeState } from './storage.js';
import { initEnabledSources } from './marketplace-registry.js';
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
let manuallyInstalled: Set<string> = new Set();
let manuallyRemoved: Set<string> = new Set();
let installedIds: Set<string> = new Set();
let setupComplete = false;
let setupState: SetupState = { complete: false, region: DEFAULT_MARKET, countries: [DEFAULT_MARKET] };

interface PersistedSettings {
  disabledSources: string[];
  manuallyInstalled: string[];
  manuallyRemoved?: string[];
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
  await initStorage(cfg);
  settingsFile = path.join(cfg.dataDir, 'adapter-settings.json');
  const existingSettings = await readState<Partial<PersistedSettings>>('adapter-settings');
  const settingsExisted = existingSettings !== null;
  await loadSettings();
  await initAdapterConfig(cfg);
  await initEnabledSources(cfg);

  const setup = await resolveSetup(cfg);
  setupComplete = setup.complete;
  regionCode = setup.region;
  defaultMarket = setup.region;
  selectedCountries = setup.complete ? (setup.countries?.length ? setup.countries : [setup.region]) : [];
  setupState = setup;

  // Compute installed set: global + selected countries + manually installed.
  const candidatePool = buildCandidatePool(cfg);
  installedIds = new Set<string>();
  for (const a of candidatePool) {
    if (!manuallyRemoved.has(a.id) && (isGlobalAdapter(a) || a.markets.some((m) => selectedCountries.includes(m)) || manuallyInstalled.has(a.id))) {
      installedIds.add(a.id);
    }
  }

  // First run: disable restricted-by-default adapters.
  if (!settingsExisted && setup.complete) {
    runtimeDisabled = new Set(['vinted', 'depop']);
    await persistSettings();
  }

  rebuildBuiltIns();

  // First run: disable adapters that are not global / not for selected countries.
  if (!settingsExisted && setup.complete) {
    const toDisable: string[] = [];
    for (const a of builtInAdapters) {
      const isDefault = isGlobalAdapter(a) || a.markets.some((m) => selectedCountries.includes(m));
      if (!isDefault) toDisable.push(a.id);
    }
    for (const id of toDisable) runtimeDisabled.add(id);
    runtimeDisabled.add('depop');
    await persistSettings();
  }

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

function isGlobalAdapter(adapter: MarketplaceAdapter): boolean {
  // Adapters that are useful in every country (official APIs, etc.).
  if (adapter.id === 'ebay') return true;
  if (adapter.id === 'sample') return true;
  return adapter.markets.length >= 50;
}

function buildCandidatePool(cfg: ServerConfig): MarketplaceAdapter[] {
  return [
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
    createMercariAdapter(cfg.scrapers),
    createBlocketAdapter(cfg.scrapers),
    createVintedAdapter(cfg.scrapers),
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
      searchPageUrl: (q, page) => `https://www.tori.fi/recommerce/forsale/search?q=${encodeURIComponent(q)}&page=${page}`,
    }),
    new SampleAdapter(cfg.enableSampleAdapter),
  ];
}

function rebuildBuiltIns(): void {
  const cfg = serverCfg;
  if (!cfg) return;
  const candidates = buildCandidatePool(cfg);
  builtInAdapters = candidates.filter((a) => installedIds.has(a.id));
}


/**
 * Rebuild custom + plugin adapters from disk. Called at boot and whenever
 * the operator changes custom sources or reloads plugins.
 */
export async function refreshDynamicAdapters(): Promise<void> {
  if (!serverCfg) return;
  const cfg = serverCfg;
  customSources = await loadCustomSources(cfg);
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
  if (pruned) await persistSettings();
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

  await saveSetupRegion(serverCfg, market.code, codes);
  regionCode = market.code;
  defaultMarket = market.code;
  selectedCountries = codes;
  setupComplete = true;
  setupState = { complete: true, region: market.code, countries: codes };

  // Reconcile the installed set from the complete country selection. Keep
  // explicit manual installs, but remove country-managed adapters no longer
  // covered by any selected country. Explicit removals remain removed until
  // the operator installs them again.
  const previouslyInstalled = new Set(installedIds);
  const nextInstalled = new Set<string>();
  for (const adapter of buildCandidatePool(serverCfg)) {
    const countryManaged = adapter.markets.some((m) => codes.includes(m));
    if (!manuallyRemoved.has(adapter.id) &&
        (isGlobalAdapter(adapter) || countryManaged || manuallyInstalled.has(adapter.id))) {
      nextInstalled.add(adapter.id);
    }
  }
  installedIds = nextInstalled;
  rebuildBuiltIns();

  // A newly installed adapter starts enabled. Keep explicit runtime
  // disable choices for adapters that were already installed.
  for (const adapter of builtInAdapters) {
    if (!previouslyInstalled.has(adapter.id) && adapter.id !== 'vinted') {
      runtimeDisabled.delete(adapter.id);
    }
  }
  persistSettings();

  await refreshDynamicAdapters();
  logEvent(
    'setup',
    'ok',
    `Region set to ${market.label} (${market.code}); ${builtInAdapters.length} built-in sources installed.`,
  );
}

export function getSetupState(): SetupState {
  return setupState;
}

export function isSetupComplete(): boolean {
  return setupComplete;
}


export function availableAdaptersList(): MarketplaceAdapter[] {
  if (!serverCfg) return [];
  return buildCandidatePool(serverCfg).filter((a) => !installedIds.has(a.id));
}

export function installAdapter(id: string): MarketplaceAdapter | null {
  if (!serverCfg) return null;
  const pool = buildCandidatePool(serverCfg);
  const adapter = pool.find((a) => a.id === id);
  if (!adapter) return null;
  manuallyInstalled.add(id);
  manuallyRemoved.delete(id);
  installedIds.add(id);
  runtimeDisabled.delete(id);
  persistSettings();
  rebuildBuiltIns();
  allAdapters = [...builtInAdapters, ...dynamicAdapters];
  return adapter;
}

export function uninstallAdapter(id: string): boolean {
  if (!serverCfg) return false;
  // Don't uninstall global adapters.
  const pool = buildCandidatePool(serverCfg);
  const adapter = pool.find((a) => a.id === id);
  if (!adapter || isGlobalAdapter(adapter)) return false;
  installedIds.delete(id);
  manuallyInstalled.delete(id);
  manuallyRemoved.add(id);
  runtimeDisabled.delete(id);
  persistSettings();
  rebuildBuiltIns();
  allAdapters = [...builtInAdapters, ...dynamicAdapters];
  return true;
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

export async function setAdapterEnabled(id: string, enabled: boolean): Promise<AdapterInfo | null> {
  const adapter = allAdapters.find((a) => a.id === id);
  if (!adapter) return null;
  if (enabled) runtimeDisabled.delete(id);
  else runtimeDisabled.add(id);
  await persistSettings();
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

async function loadSettings(): Promise<void> {
  runtimeDisabled = new Set();
  manuallyInstalled = new Set();
  manuallyRemoved = new Set();
  if (!settingsFile) return;
  try {
    const parsed = await readState<Partial<PersistedSettings>>('adapter-settings');
    if (!parsed) {
      runtimeDisabled = new Set(['vinted', 'depop']);
      await persistSettings();
      return;
    }
    const ids = Array.isArray(parsed.disabledSources) ? parsed.disabledSources : [];
    runtimeDisabled = new Set(ids.filter((id): id is string => typeof id === 'string'));
    const mi = Array.isArray(parsed.manuallyInstalled) ? parsed.manuallyInstalled : [];
    manuallyInstalled = new Set(mi.filter((id): id is string => typeof id === 'string'));
    const mr = Array.isArray(parsed.manuallyRemoved) ? parsed.manuallyRemoved : [];
    manuallyRemoved = new Set(mr.filter((id): id is string => typeof id === 'string'));
  } catch {
    /* no settings yet — all configured adapters stay enabled */
  }
}

async function persistSettings(): Promise<void> {
  if (!settingsFile) return;
  try {
    await writeState('adapter-settings', {
      disabledSources: [...runtimeDisabled],
      manuallyInstalled: [...manuallyInstalled],
      manuallyRemoved: [...manuallyRemoved],
    });
  } catch (err) {
    logEvent('settings', 'error', `Could not persist adapter settings: ${(err as Error).message}`);
  }
}


/** Read the persisted operator config for an adapter (UI-editable tokens, etc.). */
export function getAdapterConfigValues(id: string): Record<string, string> {
  return getAdapterConfig(id);
}

/** Persist operator config for an adapter. */
export async function setAdapterConfigValues(id: string, values: Record<string, string>): Promise<void> {
  await setAdapterConfig(id, values);
}
