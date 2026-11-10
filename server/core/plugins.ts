import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ServerConfig } from '../config.js';
import { findMarket, MARKETS } from './markets.js';
import { logEvent } from './events.js';
import type { MarketplaceAdapter } from './types.js';
import { getAdapterConfig } from './adapter-config.js';

/**
 * Optional source plugins. Nothing ships in `plugins/` by default: an
 * operator drops a folder in, restarts or hits "reload", and the adapter
 * joins the registry. A broken plugin never takes the server down — its
 * failure is recorded and surfaced in the settings UI.
 *
 * Folder layout:
 *   plugins/<name>/plugin.json
 *   plugins/<name>/index.js        (or .ts/.mjs; ES module or CJS)
 *
 * plugin.json:
 *   { "id": "my-source", "label": "My source", "module": "./index.js",
 *     "markets": ["CH"], "description": "...", "icon": "extension",
 *     "envVars": ["MY_API_KEY"], "docsUrl": "https://..." }
 *
 * index.js must export `createAdapters(ctx)` (or a default function) that
 * returns a MarketplaceAdapter or an array of them. The context exposes
 * `{ env, userAgent, minIntervalMs, dataDir }`.
 */

export interface PluginManifest {
  id: string;
  label: string;
  module: string;
  description?: string;
  icon?: string;
  markets?: string[];
  envVars?: string[];
  docsUrl?: string;
  configFields?: import('./types.js').AdapterConfigField[];
}

export interface PluginStatus {
  id: string;
  label: string;
  description: string;
  icon: string;
  markets: string[];
  envVars: string[];
  docsUrl?: string;
  configFields?: import('./types.js').AdapterConfigField[];
  dir: string;
  loaded: boolean;
  error?: string;
  adapterIds: string[];
}

export interface PluginContext {
  env: NodeJS.ProcessEnv;
  userAgent: string;
  minIntervalMs: number;
  dataDir: string;
  getAdapterConfig: (id: string) => Record<string, string>;
}

interface PluginModule {
  createAdapters?: (ctx: PluginContext) => unknown;
  default?: (ctx: PluginContext) => unknown;
}

export async function loadPlugins(
  cfg: ServerConfig,
  reservedIds: Set<string>,
): Promise<{ adapters: MarketplaceAdapter[]; statuses: PluginStatus[] }> {
  const adapters: MarketplaceAdapter[] = [];
  const statuses: PluginStatus[] = [];
  if (!cfg.pluginsEnabled) return { adapters, statuses };

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(cfg.pluginsDir, { withFileTypes: true });
  } catch {
    return { adapters, statuses };
  }

  const seenPluginIds = new Set<string>();
  const seenAdapterIds = new Set<string>(reservedIds);

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = path.join(cfg.pluginsDir, entry.name);
    const status: PluginStatus = {
      id: entry.name,
      label: entry.name,
      description: '',
      icon: 'extension',
      markets: [],
      envVars: [],
      dir,
      loaded: false,
      adapterIds: [],
    };

    try {
      const manifest = readManifest(dir);
      status.id = manifest.id;
      status.label = manifest.label;
      status.description = manifest.description ?? '';
      status.icon = manifest.icon ?? 'extension';
      status.markets = normalizeMarkets(manifest.markets);
      status.envVars = normalizeEnvVars(manifest.envVars);
      status.docsUrl = manifest.docsUrl;

      if (!/^[a-z][a-z0-9-]{1,39}$/.test(manifest.id)) {
        throw new Error('plugin id must be 2–40 chars (a-z, 0-9, "-"), starting with a letter');
      }
      if (seenPluginIds.has(manifest.id)) {
        throw new Error(`duplicate plugin id "${manifest.id}"`);
      }
      seenPluginIds.add(manifest.id);

      const modulePath = path.resolve(dir, manifest.module);
      if (modulePath !== dir && !modulePath.startsWith(`${dir}${path.sep}`)) {
        throw new Error('plugin module must live inside its plugin folder');
      }
      if (!fs.existsSync(modulePath)) {
        throw new Error(`module not found: ${manifest.module}`);
      }

      const mod = (await import(
        `${pathToFileURL(modulePath).href}?v=${Date.now()}`
      )) as PluginModule;
      const factory = mod.createAdapters ?? mod.default;
      if (typeof factory !== 'function') {
        throw new Error('module must export createAdapters(ctx) or a default function');
      }

      const produced = await factory({
        env: process.env,
        userAgent: cfg.scrapers.userAgent,
        minIntervalMs: cfg.scrapers.minIntervalMs,
        dataDir: cfg.dataDir,
        getAdapterConfig,
      });
      const candidates = Array.isArray(produced) ? produced : [produced];

      for (const candidate of candidates) {
        const adapter = candidate as Partial<MarketplaceAdapter> | null;
        if (!isAdapter(adapter)) {
          throw new Error('factory returned something that is not a MarketplaceAdapter');
        }
        if (seenAdapterIds.has(adapter.id)) {
          throw new Error(`adapter id "${adapter.id}" is already in use`);
        }
        seenAdapterIds.add(adapter.id);
        adapters.push(adapter);
        status.adapterIds.push(adapter.id);
      }

      status.loaded = true;
      logEvent(
        'plugins',
        'ok',
        `Plugin "${manifest.id}" loaded (${status.adapterIds.length} adapter${status.adapterIds.length === 1 ? '' : 's'}).`,
      );
    } catch (err) {
      status.error = err instanceof Error ? err.message : 'unknown plugin error';
      logEvent('plugins', 'error', `Plugin "${entry.name}" failed to load: ${status.error}`);
    }

    statuses.push(status);
  }

  return { adapters, statuses };
}

function readManifest(dir: string): PluginManifest {
  const file = path.join(dir, 'plugin.json');
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<PluginManifest>;
  if (typeof parsed.id !== 'string' || !parsed.id.trim()) {
    throw new Error('plugin.json is missing "id"');
  }
  if (typeof parsed.label !== 'string' || !parsed.label.trim()) {
    throw new Error('plugin.json is missing "label"');
  }
  if (typeof parsed.module !== 'string' || !parsed.module.trim()) {
    throw new Error('plugin.json is missing "module"');
  }
  return {
    id: parsed.id.trim().toLowerCase(),
    label: parsed.label.trim(),
    module: parsed.module.trim(),
    description: typeof parsed.description === 'string' ? parsed.description : undefined,
    icon: typeof parsed.icon === 'string' ? parsed.icon : undefined,
    markets: parsed.markets,
    envVars: parsed.envVars,
    docsUrl: typeof parsed.docsUrl === 'string' ? parsed.docsUrl : undefined,
  };
}

function normalizeMarkets(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim().toUpperCase())
        .filter((v) => MARKETS.some((m) => m.code === v)),
    ),
  ];
}

function normalizeEnvVars(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => /^[A-Z][A-Z0-9_]{0,79}$/.test(v));
}

function isAdapter(value: Partial<MarketplaceAdapter> | null): value is MarketplaceAdapter {
  return Boolean(
    value &&
      typeof value.id === 'string' &&
      /^[a-z][a-z0-9-]{1,39}$/.test(value.id) &&
      typeof value.label === 'string' &&
      (value.mode === 'live' || value.mode === 'sample') &&
      Array.isArray(value.markets) &&
      value.markets.every((m) => typeof m === 'string' && findMarket(m) != null) &&
      typeof value.search === 'function' &&
      typeof value.healthCheck === 'function' &&
      typeof value.isEnabled === 'function' &&
      typeof value.disabledReason === 'function',
  );
}
