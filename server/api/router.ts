import { Router } from 'express';
import type { ServerConfig } from '../config.js';
import type { AdapterInfo } from '../core/types.js';
import {
  describeAdapter,
  enabledAdapters,
  getAdapters,
  getCustomSources,
  getDefaultMarket,
  getPluginStatuses,
  getPluginsDir,
  getRegion,
  availableAdaptersList,
  getReservedSourceIds,
  getSetupState,
  installAdapter,
  uninstallAdapter,
  isSetupComplete,
  refreshDynamicAdapters,
  runHealthCheck,
  setAdapterEnabled,
  setRegion,
} from '../core/registry.js';
import {
  removeCustomSource,
  upsertCustomSource,
  validateCustomSource,
} from '../core/custom-sources.js';
import { SOURCE_CATALOG } from '../core/source-catalog.js';
import { REGION_PACKS } from '../core/regions.js';
import { recentEvents } from '../core/events.js';
import { listFavorites, addFavorite, removeFavorite } from '../core/favorites.js';
import type { StoredFavorite } from '../core/favorites.js';
import { findMarket, MARKETS } from '../core/markets.js';
import { parseSearchParams, runSearch, ValidationError } from '../core/search.js';
import { asRecord, str } from '../adapters/scrape.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getAdapterConfig, setAdapterConfig } from '../core/adapter-config.js';
import { fetchDeals } from '../core/deal-radar.js';
import {
  listCountries,
  getCountry,
  listMarketplaces,
  getMarketplace,
  countryMarketplaces,
  countryMarketplaceMappings,
  registryVersion,
  readEnabledSources,
  writeEnabledSources,
  enabledForCountry,
} from '../core/marketplace-registry.js';

function marketParam(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new ValidationError('"market" must be a single market code.');
  }
  const market = findMarket(value.trim());
  if (!market) {
    throw new ValidationError(
      `Invalid "market" value. Allowed: ${MARKETS.map((m) => m.code).join(', ')}.`,
    );
  }
  return market.code;
}

export function apiRouter(cfg: ServerConfig): Router {
  const router = Router();

  router.get('/search', async (req, res, next) => {
    try {
      if (!isSetupComplete()) {
        res.status(409).json({
          error: {
            code: 'SETUP_REQUIRED',
            message: 'Choose your region first so Fundstueck can install that region’s sources.',
          },
        });
        return;
      }
      const query = parseSearchParams(req.query, getDefaultMarket());
      const enabled = enabledAdapters(query.market);
      if (enabled.length === 0) {
        const market = findMarket(query.market);
        res.status(503).json({
          error: {
            code: 'NO_SOURCES',
            message: `No marketplace source is available for ${market?.label ?? query.market}. Configure eBay credentials (marketplace ${market?.ebayMarketplaceId ?? '—'}), add a custom source, enable a source, or change region on the source settings page.`,
          },
        });
        return;
      }
      res.json(await runSearch(enabled, query));
    } catch (err) {
      next(err);
    }
  });

  router.get('/sources', (req, res, next) => {
    try {
      const market = marketParam(req.query['market']);
      const sources = getAdapters()
        .map(describeAdapter)
        .filter((a) => market == null || a.markets.includes(market));
      res.json({ sources });
    } catch (err) {
      next(err);
    }
  });

  router.get('/markets', (_req, res) => {
    const adapters = getAdapters().map(describeAdapter);
    res.json({
      default: getDefaultMarket(),
      region: getRegion(),
      setupComplete: isSetupComplete(),
      markets: MARKETS.map((m) => {
        const scoped = adapters.filter((a) => a.markets.includes(m.code));
        return {
          ...m,
          sources: {
            total: scoped.length,
            enabled: scoped.filter((a) => a.enabled).length,
          },
        };
      }),
    });
  });

  router.post('/sources/:id/enabled', async (req, res) => {
    const enabled = (req.body as { enabled?: unknown } | undefined)?.enabled;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Body must be { "enabled": boolean }.' },
      });
      return;
    }
    const info = await setAdapterEnabled(req.params.id, enabled);
    if (!info) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown source.' } });
      return;
    }
    res.json({ source: info });
  });

  router.get('/sources/:id/health', async (req, res, next) => {
    try {
      const health = await runHealthCheck(req.params.id);
      if (!health) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown source.' } });
        return;
      }
      res.json({
        source: req.params.id,
        ...health,
        checkedAt: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  // ---- Adapter install/uninstall (cross-country) ----

  router.get('/adapters/available', (_req, res) => {
    const adapters = availableAdaptersList().map(describeAdapter);
    res.json({ adapters });
  });

  router.post('/adapters/:id/install', (req, res) => {
    const adapter = installAdapter(req.params.id);
    if (!adapter) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown or already installed adapter.' } });
      return;
    }
    res.json({ adapter: describeAdapter(adapter) });
  });

  router.post('/adapters/:id/uninstall', (req, res) => {
    const ok = uninstallAdapter(req.params.id);
    if (!ok) {
      res.status(400).json({ error: { code: 'CANNOT_UNINSTALL', message: 'Cannot uninstall this adapter (global or unknown).' } });
      return;
    }
    res.json({ ok: true });
  });

  // ---- First-run region setup ----

  router.get('/setup', (_req, res) => {
    const state = getSetupState();
    res.json({
      ...state,
      regions: REGION_PACKS,
    });
  });

  router.post('/setup', async (req, res, next) => {
    try {
      const body = asRecord(req.body) ?? {};
      const region = body['region'];
      if (typeof region !== 'string' || !findMarket(region.trim())) {
        res.status(400).json({
          error: {
            code: 'INVALID_REQUEST',
            message: `Body must be { "region": one of ${MARKETS.map((m) => m.code).join(', ')} }.`,
          },
        });
        return;
      }
      const countriesRaw = body['countries'];
      const countries = Array.isArray(countriesRaw)
        ? countriesRaw.map((c) => String(c).trim().toUpperCase()).filter((c) => findMarket(c))
        : undefined;
      await setRegion(region.trim().toUpperCase(), countries);
      const state = getSetupState();
      res.json({
        ...state,
        regions: REGION_PACKS,
        sources: getAdapters().map(describeAdapter),
      });
    } catch (err) {
      next(err);
    }
  });

  // ---- Marketplace registry (country-aware) ----

  router.get('/registry/version', (_req, res) => {
    res.json(registryVersion());
  });

  router.get('/registry/countries', (_req, res) => {
    res.json({ countries: listCountries() });
  });

  router.get('/registry/countries/:code', (req, res) => {
    const country = getCountry(req.params.code);
    if (!country) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown country.' } });
      return;
    }
    res.json({ country });
  });

  router.get('/registry/countries/:code/marketplaces', (req, res) => {
    const country = getCountry(req.params.code);
    if (!country) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown country.' } });
      return;
    }
    const mappings = countryMarketplaceMappings(req.params.code);
    const marketplaces = countryMarketplaces(req.params.code).map((m) => {
      const mapping = mappings.find((x) => x.marketplace_id === m.id);
      return { ...m, priority: mapping?.priority ?? 99, country_notes: mapping?.notes ?? '' };
    });
    const enabled = enabledForCountry(cfg.dataDir, req.params.code.toUpperCase());
    res.json({
      country,
      marketplaces,
      enabled,
    });
  });

  router.get('/registry/marketplaces', (_req, res) => {
    res.json({ marketplaces: listMarketplaces() });
  });

  router.get('/registry/marketplaces/:id', (req, res) => {
    const m = getMarketplace(req.params.id);
    if (!m) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown marketplace.' } });
      return;
    }
    res.json({ marketplace: m });
  });

  router.get('/registry/enabled/:code', (req, res) => {
    const code = req.params.code.toUpperCase();
    res.json({ country: code, enabled: enabledForCountry(cfg.dataDir, code) });
  });

  router.post('/registry/enabled/:code', (req, res) => {
    const code = req.params.code.toUpperCase();
    const body = req.body as { enabled?: unknown } | undefined;
    if (!getCountry(code)) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown country.' } });
      return;
    }
    if (!Array.isArray(body?.enabled) || body.enabled.some((id) => typeof id !== 'string')) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Body must be { "enabled": string[] }.' } });
      return;
    }
    const requested = body.enabled as string[];
    const eligible = new Set(countryMarketplaces(code)
      .filter((m) => m.adapter_status === 'implemented')
      .filter((m) => m.automation_permission === 'authorized')
      .map((m) => m.id));
    const rejected = requested.filter((id) => !eligible.has(id));
    if (rejected.length) {
      res.status(400).json({
        error: {
          code: 'SOURCE_NOT_ELIGIBLE',
          message: 'Only implemented sources explicitly assessed as authorized can be enabled.',
          sources: rejected,
        },
      });
      return;
    }
    const prefs = readEnabledSources(cfg.dataDir);
    prefs[code] = [...new Set(requested)];
    writeEnabledSources(cfg.dataDir, prefs);
    res.json({ country: code, enabled: prefs[code] });
  });

  // ---- Optional sources: plugins + operator-defined custom sources ----

  router.get('/sources/:id/config', (req, res) => {
    const adapter = getAdapters().find((a) => a.id === req.params.id);
    if (!adapter) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown source.' } });
      return;
    }
    const fields = adapter.configFields ?? [];
    const stored = getAdapterConfig(req.params.id);
    const values: Record<string, string> = {};
    for (const f of fields) {
      if (f.secret) {
        values[f.key] = stored[f.key] ? '••••••••' : '';
      } else {
        values[f.key] = stored[f.key] ?? f.default ?? '';
      }
    }
    res.json({ fields, values, hasSecret: Object.fromEntries(fields.map((f) => [f.key, Boolean(stored[f.key])])) });
  });

  router.post('/sources/:id/config', async (req, res) => {
    const adapter = getAdapters().find((a) => a.id === req.params.id);
    if (!adapter) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown source.' } });
      return;
    }
    const fields = adapter.configFields ?? [];
    const body = asRecord(req.body) ?? {};
    const current = getAdapterConfig(req.params.id);
    const next: Record<string, string> = { ...current };
    for (const f of fields) {
      const v = body[f.key];
      if (typeof v !== 'string') continue;
      if (f.secret && v === '') {
        // keep existing secret
        continue;
      }
      if (v === '') delete next[f.key];
      else next[f.key] = v;
    }
    await setAdapterConfig(req.params.id, next);
    res.json({ ok: true });
  });

  router.post('/catalog/:id/install', async (req, res) => {
    const entry = SOURCE_CATALOG.find((e) => e.id === req.params.id);
    if (!entry) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown catalog entry.' } });
      return;
    }
    if (!entry.installCommand || entry.installCommand.length === 0) {
      res.status(400).json({ error: { code: 'NO_INSTALL', message: 'No install command for this entry.' } });
      return;
    }
    try {
      const { stdout, stderr } = await promisify(execFile)(entry.installCommand[0], entry.installCommand.slice(1), {
        cwd: process.cwd(),
        env: {
          ...process.env,
          FUNDSTUECK_RICARDO_VENV: process.env.FUNDSTUECK_RICARDO_VENV ?? '/app/.venvs/ricardo',
        },
        timeout: 300_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      let createdSource: AdapterInfo | null = null;
      if (entry.template) {
        const validation = validateCustomSource(entry.template, {
          reservedIds: getReservedSourceIds(),
        });
        if (validation.ok) {
          upsertCustomSource(cfg, validation.value);
          await refreshDynamicAdapters();
          createdSource =
            getAdapters().find((a) => a.id === validation.value.id)
              ? describeAdapter(getAdapters().find((a) => a.id === validation.value.id)!)
              : null;
        }
      }
      res.json({
        ok: true,
        stdout: stdout.slice(-2000),
        stderr: stderr.slice(-2000),
        source: createdSource,
      });
    } catch (err) {
      res.status(500).json({
        error: { code: 'INSTALL_FAILED', message: (err as Error).message.slice(0, 500) },
      });
    }
  });

  router.get('/plugins', (_req, res) => {
    res.json({
      plugins: getPluginStatuses(),
      customSources: getCustomSources(),
      catalog: SOURCE_CATALOG,
      pluginsDir: getPluginsDir(),
      region: getRegion(),
      setupComplete: isSetupComplete(),
    });
  });

  router.post('/plugins/reload', async (_req, res, next) => {
    try {
      await refreshDynamicAdapters();
      res.json({ plugins: getPluginStatuses(), sources: getAdapters().map(describeAdapter) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/custom-sources', async (req, res, next) => {
    try {
      const body = asRecord(req.body);
      const rawId = str(body?.id)?.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const existing = rawId ? getCustomSources().find((s) => s.id === rawId) : undefined;
      const reserved = getReservedSourceIds();
      if (existing) reserved.delete(existing.id);

      const result = validateCustomSource(body, {
        reservedIds: reserved,
        currentId: existing?.id,
      });
      if (!result.ok) {
        res.status(400).json({ error: { code: 'INVALID_REQUEST', message: result.error } });
        return;
      }

      await upsertCustomSource(cfg, result.value);
      await refreshDynamicAdapters();
      const adapter = getAdapters().find((a) => a.id === result.value.id);
      if (!adapter) {
        res.status(400).json({
          error: {
            code: 'INVALID_REQUEST',
            message: 'Source was saved but could not be loaded. Check the server events.',
          },
        });
        return;
      }
      res.status(existing ? 200 : 201).json({
        customSource: result.value,
        source: describeAdapter(adapter),
      });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/custom-sources/:id', async (req, res, next) => {
    try {
      const removed = await removeCustomSource(cfg, req.params.id);
      if (!removed) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown custom source.' } });
        return;
      }
      await refreshDynamicAdapters();
      res.json({ removed: req.params.id, sources: getAdapters().map(describeAdapter) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/sources/:id/test', async (req, res) => {
    const adapter = getAdapters().find((a) => a.id === req.params.id);
    if (!adapter) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown source.' } });
      return;
    }
    const started = Date.now();
    try {
      const listings = await adapter.search({
        q: 'velo',
        limit: 3,
        market: adapter.markets[0],
      });
      res.json({
        source: adapter.id,
        ok: true,
        latencyMs: Date.now() - started,
        count: listings.length,
        sample: listings.slice(0, 1),
      });
    } catch (err) {
      res.json({
        source: adapter.id,
        ok: false,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : 'Source test failed.',
      });
    }
  });

  router.get('/deals', async (_req, res, next) => {
    try {
      const deals = await fetchDeals(50);
      res.json({ deals });
    } catch (err) {
      next(err);
    }
  });

  router.get('/favorites', (req, res) => {
    const device = typeof req.query.device === 'string' ? req.query.device.trim() : '';
    if (!device) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: '"device" query param is required.' } });
      return;
    }
    res.json({ favorites: listFavorites(device) });
  });

  router.post('/favorites', async (req, res) => {
    const body = asRecord(req.body) ?? {};
    const device = str(body.device);
    const listing = asRecord(body.listing);
    if (!device || !listing) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Body must include device and listing.' } });
      return;
    }
    const fav: StoredFavorite = {
      id: str(listing.id) ?? '',
      source: str(listing.source) ?? '',
      title: str(listing.title) ?? '',
      price: typeof listing.price === 'number' ? listing.price : null,
      currency: str(listing.currency) ?? 'CHF',
      listingUrl: str(listing.listingUrl) ?? '',
      imageUrl: str(listing.imageUrl) ?? null,
      savedAt: new Date().toISOString(),
    };
    if (!fav.id || !fav.listingUrl) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Listing is missing id or listingUrl.' } });
      return;
    }
    await addFavorite(device, fav);
    res.json({ ok: true });
  });

  router.delete('/favorites', async (req, res) => {
    const body = asRecord(req.body) ?? {};
    const device = str(body.device) ?? (typeof req.query.device === 'string' ? req.query.device : '');
    const listingId = str(body.listingId) ?? (typeof req.query.listingId === 'string' ? req.query.listingId : '');
    if (!device || !listingId) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'device and listingId are required.' } });
      return;
    }
    await removeFavorite(device, listingId);
    res.json({ ok: true });
  });

  router.get('/events', (req, res) => {
    const raw = Number(req.query.limit ?? 60);
    const limit = Number.isFinite(raw) ? raw : 60;
    res.json({ events: recentEvents(limit) });
  });

  router.get('/system', (_req, res) => {
    const mem = process.memoryUsage();
    const adapters = getAdapters().map(describeAdapter);
    res.json({
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      env: process.env.NODE_ENV ?? 'development',
      uptimeSec: Math.round(process.uptime()),
      rssMb: Number((mem.rss / 1048576).toFixed(1)),
      heapUsedMb: Number((mem.heapUsed / 1048576).toFixed(1)),
      adapters: {
        total: adapters.length,
        configured: adapters.filter((a) => a.configured).length,
        enabled: adapters.filter((a) => a.enabled).length,
      },
    });
  });

  return router;
}

export function validationErrorHandler(
  err: unknown,
  _req: unknown,
  res: { status: (n: number) => { json: (b: unknown) => void } },
  next: (e?: unknown) => void,
): void {
  if (err instanceof ValidationError) {
    res.status(err.statusCode).json({
      error: { code: 'INVALID_REQUEST', message: err.message },
    });
    return;
  }
  next(err);
}
