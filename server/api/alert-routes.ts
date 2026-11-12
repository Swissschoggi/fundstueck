import type { Request, Response, Router } from 'express';
import type { ServerConfig } from '../config.js';
import { asRecord, str } from '../adapters/scrape.js';
import { ownerKeyFor } from './auth-routes.js';
import {
  createWatcher,
  deleteWatcher,
  getNotificationSettings,
  listAlerts,
  listWatchers,
  runWatcherNow,
  setNotificationSettings,
  testDispatch,
  updateWatcher,
  type NotifyChannel,
  type NotificationSettings,
  type WatcherInput,
} from '../core/alerts.js';

function ownerOrError(req: Request, res: Response, device: unknown): string | null {
  const key = ownerKeyFor(req, device);
  if (!key) {
    res.status(400).json({ error: { code: 'INVALID_REQUEST', message: '"device" is required when signed out.' } });
    return null;
  }
  return key;
}

function optionalNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function watcherInput(body: Record<string, unknown>, partial: boolean): { input: WatcherInput } | { error: string } {
  const query = str(body.query ?? body.q);
  if (!partial && !query) return { error: '"query" is required.' };
  if (query != null && query.length > 200) return { error: '"query" must be at most 200 characters.' };
  const market = str(body.market) ?? 'CH';
  const minPrice = optionalNumber(body.minPrice ?? body.min);
  const maxPrice = optionalNumber(body.maxPrice ?? body.max);
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    return { error: '"minPrice" must not exceed "maxPrice".' };
  }
  const input: WatcherInput = {
    label: str(body.label) ?? undefined,
    query: query ?? '',
    market,
    minPrice,
    maxPrice,
    sources: Array.isArray(body.sources) ? (body.sources as string[]) : undefined,
    notifications: Array.isArray(body.notifications) ? (body.notifications as NotifyChannel[]) : undefined,
    enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    highPriority: typeof body.highPriority === 'boolean' ? body.highPriority : undefined,
  };
  return { input };
}

export function mountAlertRoutes(router: Router, _cfg: ServerConfig): void {
  router.get('/alerts/watchers', async (req, res, next) => {
    try {
      const key = ownerOrError(req, res, req.query.device);
      if (!key) return;
      res.json({ watchers: await listWatchers(key) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/alerts/watchers', async (req, res, next) => {
    try {
      const body = asRecord(req.body) ?? {};
      const key = ownerOrError(req, res, body.device);
      if (!key) return;
      const parsed = watcherInput(body, false);
      if ('error' in parsed) {
        res.status(400).json({ error: { code: 'INVALID_REQUEST', message: parsed.error } });
        return;
      }
      const watcher = await createWatcher(key, parsed.input);
      res.status(201).json({ watcher });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/alerts/watchers/:id', async (req, res, next) => {
    try {
      const body = asRecord(req.body) ?? {};
      const key = ownerOrError(req, res, body.device);
      if (!key) return;
      const parsed = watcherInput(body, true);
      if ('error' in parsed) {
        res.status(400).json({ error: { code: 'INVALID_REQUEST', message: parsed.error } });
        return;
      }
      const watcher = await updateWatcher(key, req.params.id, parsed.input);
      if (!watcher) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown watcher.' } });
        return;
      }
      res.json({ watcher });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/alerts/watchers/:id', async (req, res, next) => {
    try {
      const body = asRecord(req.body) ?? {};
      const key = ownerOrError(req, res, body.device ?? req.query.device);
      if (!key) return;
      const ok = await deleteWatcher(key, req.params.id);
      if (!ok) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown watcher.' } });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/alerts/watchers/:id/run', async (req, res, next) => {
    try {
      const body = asRecord(req.body) ?? {};
      const key = ownerOrError(req, res, body.device ?? req.query.device);
      if (!key) return;
      const result = await runWatcherNow(key, req.params.id);
      if (!result) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown watcher.' } });
        return;
      }
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get('/alerts', async (req, res, next) => {
    try {
      const key = ownerOrError(req, res, req.query.device);
      if (!key) return;
      const limit = Number(req.query.limit ?? 100);
      res.json({ alerts: await listAlerts(key, Number.isFinite(limit) ? limit : 100) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/alerts/settings', async (req, res, next) => {
    try {
      const key = ownerOrError(req, res, req.query.device);
      if (!key) return;
      res.json({ settings: await getNotificationSettings(key) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/alerts/settings', async (req, res, next) => {
    try {
      const body = asRecord(req.body) ?? {};
      const key = ownerOrError(req, res, body.device);
      if (!key) return;
      const raw = asRecord(body.settings) ?? {};
      const patch: Partial<NotificationSettings> = {};
      if (raw.telegram != null) {
        const t = asRecord(raw.telegram) ?? {};
        patch.telegram = { botToken: str(t.botToken) ?? '', chatId: str(t.chatId) ?? '' };
      }
      if (raw.discord != null) {
        const d = asRecord(raw.discord) ?? {};
        patch.discord = { webhookUrl: str(d.webhookUrl) ?? '' };
      }
      if (raw.webhook != null) {
        const w = asRecord(raw.webhook) ?? {};
        patch.webhook = { url: str(w.url) ?? '' };
      }
      if (raw.email != null) {
        const e = asRecord(raw.email) ?? {};
        patch.email = { address: str(e.address) ?? '' };
      }
      res.json({ settings: await setNotificationSettings(key, patch) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/alerts/test', async (req, res, next) => {
    try {
      const body = asRecord(req.body) ?? {};
      const key = ownerOrError(req, res, body.device ?? req.query.device);
      if (!key) return;
      res.json(await testDispatch(key));
    } catch (err) {
      next(err);
    }
  });
}
