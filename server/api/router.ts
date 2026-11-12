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
import { mountAuthRoutes, operatorGuard, ownerKeyFor } from './auth-routes.js';
import { mountAlertRoutes } from './alert-routes.js';
import { getUserPrefs } from '../core/user-prefs.js';
import { findMarket, MARKETS } from '../core/markets.js';
import { parseSearchParams, runSearch, ValidationError } from '../core/search.js';
import { asRecord, str } from '../adapters/scrape.js';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { getAdapterConfig, setAdapterConfig } from '../core/adapter-config.js';
import { getEngineSettings, setEngineSettings } from '../core/engine-settings.js';
import { alertPollIntervalMs } from '../core/alerts.js';
import { fetchDeals, getPriceHistory, getPriceStats } from '../core/deal-radar.js';
import { toBase64Image } from '../core/image-utils.js';
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
  const admin = operatorGuard(cfg);

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
      const operatorEnabled = enabledAdapters(query.market);
      // Per-account (or per-device) source choices narrow what the operator allows.
      const userDisabled = new Set(getUserPrefs(ownerKeyFor(req, req.query.device)).disabledSources);
      const enabled = operatorEnabled.filter((a) => !userDisabled.has(a.id));
      if (operatorEnabled.length > 0 && enabled.length === 0) {
        res.status(503).json({
          error: {
            code: 'NO_SOURCES',
            message: 'You switched off every source for this market. Turn at least one back on in Settings.',
          },
        });
        return;
      }
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
      // Stop all adapter work if the client navigates away or cancels.
      const abort = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) abort.abort();
      });
      const result = await runSearch(enabled, query, { signal: abort.signal });
      if (!res.writableEnded) res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get('/sources', (req, res, next) => {
    try {
      const market = marketParam(req.query['market']);
      const userDisabled = new Set(getUserPrefs(ownerKeyFor(req, req.query.device)).disabledSources);
      const sources = getAdapters()
        .map(describeAdapter)
        .filter((a) => market == null || a.markets.includes(market))
        // `enabled` stays the operator/global state; `userEnabled` is what THIS
        // person's searches will actually use.
        .map((a) => ({ ...a, userEnabled: a.enabled && !userDisabled.has(a.source) }));
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

  router.post('/sources/:id/enabled', admin, async (req, res) => {
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

  router.post('/adapters/:id/install', admin, (req, res) => {
    const adapter = installAdapter(req.params.id);
    if (!adapter) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown or already installed adapter.' } });
      return;
    }
    res.json({ adapter: describeAdapter(adapter) });
  });

  router.post('/adapters/:id/uninstall', admin, (req, res) => {
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

  router.post('/setup', admin, async (req, res, next) => {
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

  router.post('/registry/enabled/:code', admin, (req, res) => {
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

  router.get('/sources/:id/config', admin, (req, res) => {
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

  router.post('/sources/:id/config', admin, async (req, res) => {
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

  router.post('/catalog/:id/install', admin, async (req, res) => {
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
          FUNDSTUECK_RICARDO_VENV: process.env.FUNDSTUECK_RICARDO_VENV ?? '/app/data/.venvs/ricardo',
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

  router.post('/plugins/reload', admin, async (_req, res, next) => {
    try {
      await refreshDynamicAdapters();
      res.json({ plugins: getPluginStatuses(), sources: getAdapters().map(describeAdapter) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/custom-sources', admin, async (req, res, next) => {
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

  router.delete('/custom-sources/:id', admin, async (req, res, next) => {
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

  router.get('/listings/:id/history', async (req, res, next) => {
    try {
      const id = req.params.id;
      const [history, stats] = await Promise.all([getPriceHistory(id), getPriceStats(id)]);
      res.json({ listingId: id, history, stats });
    } catch (err) {
      next(err);
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

  // eBay Marketplace Account Deletion/Closure notification endpoint.
  // Required to keep a production eBay keyset active. eBay calls GET with a
  // challenge_code and expects back sha256(challengeCode + verificationToken
  // + endpointURL) hex-encoded; it later calls POST with the actual
  // notification, which must just be acknowledged with 200.
  // https://developer.ebay.com/marketplace-account-deletion
  router.get('/ebay/account-deletion', (req, res) => {
    const challengeCode = String(req.query['challenge_code'] ?? '');
    const { verificationToken, notificationEndpoint } = cfg.ebay;
    if (!challengeCode || !verificationToken || !notificationEndpoint) {
      res.status(503).json({
        error: {
          code: 'NOT_CONFIGURED',
          message:
            'Set EBAY_VERIFICATION_TOKEN and EBAY_NOTIFICATION_ENDPOINT to answer eBay\'s account-deletion challenge.',
        },
      });
      return;
    }
    const challengeResponse = createHash('sha256')
      .update(challengeCode)
      .update(verificationToken)
      .update(notificationEndpoint)
      .digest('hex');
    res.status(200).json({ challengeResponse });
  });
  router.post('/ebay/account-deletion', (_req, res) => {
    // No eBay user data is stored by this app (searches are anonymous), so
    // there is nothing to delete beyond acknowledging the notification.
    res.status(200).end();
  });

  mountAuthRoutes(router, cfg);
  mountAlertRoutes(router, cfg);

  router.get('/image-search', (req, res) => {
    const imageUrl = typeof req.query.url === 'string' ? req.query.url : '';
    if (!cfg.imageSearchUrl) {
      res.status(404).json({ error: { code: 'NOT_CONFIGURED', message: 'No image search engine configured.' } });
      return;
    }
    if (!imageUrl) {
      res.json({ template: cfg.imageSearchUrl });
      return;
    }
    const url = cfg.imageSearchUrl.replace('{image}', encodeURIComponent(imageUrl));
    res.json({ url });
  });

  router.post('/ai/chat', async (req, res) => {
    const body = asRecord(req.body) ?? {};
    const endpoint = str(body.endpoint);
    const model = str(body.model);
    if (!endpoint || !model) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'endpoint and model are required.' } });
      return;
    }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const maxTokens = typeof body.max_tokens === 'number' ? body.max_tokens : 30;
    const temperature = typeof body.temperature === 'number' ? body.temperature : 0.1;
    const topP = typeof body.top_p === 'number' ? body.top_p : 0.8;
    const repeatPenalty = typeof body.repeat_penalty === 'number' ? body.repeat_penalty : 1.15;
    const apiKey = str(body.apiKey);

    let base = endpoint.replace(/\/$/, '');
    const nativeOllama = !/\/v1$/i.test(base);

    // Convert any http(s) image_url to a base64 data URL (Ollama needs this).
    const transformedMessages = await Promise.all(messages.map(async (m: unknown) => {
      const msg = (m && typeof m === 'object') ? (m as Record<string, unknown>) : null;
      if (!msg || !Array.isArray(msg.content)) return msg;
      const content = await Promise.all((msg.content as unknown[]).map(async (part: unknown) => {
        const p = (part && typeof part === 'object') ? (part as Record<string, unknown>) : null;
        if (!p || p.type !== 'image_url') return part;
        const iu = p.image_url && typeof p.image_url === 'object' ? (p.image_url as Record<string, unknown>) : null;
        const url = typeof iu?.url === 'string' ? iu.url : '';
        if (!/^https?:\/\//i.test(url)) return part;
        try {
          const imgRes = await fetch(url, { signal: AbortSignal.timeout(30000) });
          if (!imgRes.ok) return part;
          const buf = Buffer.from(await imgRes.arrayBuffer());
          const ct = imgRes.headers.get('content-type') || 'image/jpeg';
          return { ...p, image_url: { url: `data:${ct};base64,${buf.toString('base64')}` } };
        } catch {
          return part;
        }
      }));
      return { ...msg, content };
    }));

    try {
      if (nativeOllama) {
        const systemMsg = messages.find((m: unknown) => (m as any)?.role === 'system');
        const userMsg = [...transformedMessages].reverse().find((m: unknown) => (m as any)?.role === 'user') as any;
        const prompt = typeof userMsg?.content === 'string'
          ? userMsg.content
          : Array.isArray(userMsg?.content)
            ? (userMsg.content as any[]).filter((c) => c?.type === 'text').map((c) => c.text).join(' ')
            : '';
        const imgPart = Array.isArray(userMsg?.content)
          ? (userMsg.content as any[]).find((c) => c?.type === 'image_url')
          : null;
        const imgUrl = imgPart?.image_url?.url ?? '';
        if (!imgUrl) {
          res.status(400).json({ error: { code: 'INVALID_IMAGE', message: 'No image data available for this request.' } });
          return;
        }
        let base64 = '';
        try {
          base64 = await toBase64Image(imgUrl);
        } catch (err) {
          res.status(400).json({ error: { code: 'INVALID_IMAGE', message: err instanceof Error ? err.message : 'image conversion failed' } });
          return;
        }
        if (!base64) {
          res.status(400).json({ error: { code: 'INVALID_IMAGE', message: 'No image data available for this request.' } });
          return;
        }
        if (!/^[A-Za-z0-9+\\/]+=*$/.test(base64)) {
          res.status(400).json({ error: { code: 'INVALID_IMAGE', message: 'Image data is not valid base64.' } });
          return;
        }
        const ollamaRes = await fetch(`${base}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            system: typeof systemMsg?.content === 'string' ? systemMsg.content : undefined,
            prompt,
            images: [base64],
            stream: false,
            options: {
              temperature,
              top_p: topP,
              repeat_penalty: repeatPenalty,
              num_predict: maxTokens * 4,
            },
          }),
          signal: AbortSignal.timeout(120000),
        });
        const data = await ollamaRes.json().catch(() => ({} as any));
        if (!ollamaRes.ok) {
          res.status(ollamaRes.status).json({ error: { code: 'UPSTREAM', message: (data as any)?.error ?? `HTTP ${ollamaRes.status}` } });
          return;
        }
        const text = (data as any)?.response ?? '';
        res.json({ choices: [{ message: { content: text } }] });
        return;
      }

      const url = `${base}/v1/chat/completions`;
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ model, messages: transformedMessages, max_tokens: maxTokens, temperature, top_p: topP }),
        signal: AbortSignal.timeout(120000),
      });
      const data = await r.json().catch(() => ({} as any));
      if (!r.ok) {
        res.status(r.status).json({ error: { code: 'UPSTREAM', message: (data as any)?.error?.message ?? `HTTP ${r.status}` } });
        return;
      }
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: { code: 'NETWORK', message: err instanceof Error ? err.message : 'Proxy request failed.' } });
    }
  });

  router.get('/engine/settings', (_req, res) => {
    res.json({ settings: getEngineSettings(), alertPollMs: alertPollIntervalMs() });
  });

  router.post('/engine/settings', admin, async (req, res, next) => {
    try {
      const body = asRecord(req.body) ?? {};
      const patch: Record<string, unknown> = {};
      if (body.titleThreshold !== undefined) patch.titleThreshold = body.titleThreshold;
      if (body.priceAllowancePct !== undefined) patch.priceAllowancePct = body.priceAllowancePct;
      if (body.imageMatch !== undefined) patch.imageMatch = body.imageMatch === true;
      const settings = await setEngineSettings(patch);
      res.json({ settings });
    } catch (err) {
      next(err);
    }
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
