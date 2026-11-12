import { randomUUID } from 'node:crypto';
import type { ServerConfig } from '../config.js';
import { readState, writeState } from './storage.js';
import { logEvent } from './events.js';
import { parseSearchParams, runSearch } from './search.js';
import { enabledAdapters } from './registry.js';
import { findMarket } from './markets.js';
import type { NormalizedListing } from './types.js';

/**
 * Saved searches ("watchers") + background alert engine.
 *
 * A watcher is a persisted search that is periodically re-run against the
 * enabled marketplace adapters. New listings (and price drops on previously
 * seen listings) become alerts, which can be forwarded to external channels
 * (Telegram, Discord webhook, generic webhook).
 *
 * Watchers and their alert feed are owned per account (or anonymous device),
 * mirroring favorites / user preferences.
 */

const MAX_SEEN = 1500;
const MAX_ALERTS = 2000;

export type AlertReason = 'new' | 'price-drop';
export type NotifyChannel = 'telegram' | 'discord' | 'webhook' | 'email';

export interface WatcherSeenEntry {
  id: string;
  price: number | null;
}

export interface SearchWatcher {
  id: string;
  ownerKey: string;
  label: string;
  query: string;
  market: string;
  minPrice: number | null;
  maxPrice: number | null;
  /** Adapter ids to query; empty means "all enabled sources for the market". */
  sources: string[];
  notifications: NotifyChannel[];
  enabled: boolean;
  highPriority: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  lastTriggeredAt: string | null;
  lastError: string | null;
  seen: WatcherSeenEntry[];
}

export interface AlertListing {
  id: string;
  source: string;
  title: string;
  price: number | null;
  currency: string;
  listingUrl: string;
  imageUrl: string | null;
  location: string | null;
  previousPrice?: number | null;
}

export interface AlertRecord {
  id: string;
  ownerKey: string;
  watcherId: string;
  watcherLabel: string;
  reason: AlertReason;
  listing: AlertListing;
  createdAt: string;
}

export interface NotificationSettings {
  telegram: { botToken: string; chatId: string };
  discord: { webhookUrl: string };
  webhook: { url: string };
  email: { address: string };
}

interface AlertsStore {
  watchers: SearchWatcher[];
  alerts: AlertRecord[];
  settings: Record<string, NotificationSettings>;
}

let store: AlertsStore = { watchers: [], alerts: [], settings: {} };
let loaded = false;
let writeQueue: Promise<unknown> = Promise.resolve();

const EMPTY_SETTINGS: NotificationSettings = {
  telegram: { botToken: '', chatId: '' },
  discord: { webhookUrl: '' },
  webhook: { url: '' },
  email: { address: '' },
};

export async function initAlerts(_cfg: ServerConfig): Promise<void> {
  const parsed = await readState<Partial<AlertsStore>>('alerts');
  store = {
    watchers: Array.isArray(parsed?.watchers) ? parsed!.watchers : [],
    alerts: Array.isArray(parsed?.alerts) ? parsed!.alerts : [],
    settings: parsed?.settings && typeof parsed.settings === 'object' ? parsed!.settings : {},
  };
  loaded = true;
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  const parsed = await readState<Partial<AlertsStore>>('alerts');
  store = {
    watchers: Array.isArray(parsed?.watchers) ? parsed!.watchers : [],
    alerts: Array.isArray(parsed?.alerts) ? parsed!.alerts : [],
    settings: parsed?.settings && typeof parsed.settings === 'object' ? parsed!.settings : {},
  };
  loaded = true;
}

function persist(): Promise<void> {
  const run = writeQueue.then(() => writeState('alerts', store), () => writeState('alerts', store));
  writeQueue = run.catch(() => {});
  return run;
}

// ---------- Watchers ----------

export interface WatcherInput {
  label?: string;
  query: string;
  market: string;
  minPrice?: number | null;
  maxPrice?: number | null;
  sources?: string[];
  notifications?: NotifyChannel[];
  enabled?: boolean;
  highPriority?: boolean;
}

function sanitizeNotifications(raw: unknown): NotifyChannel[] {
  const allowed: NotifyChannel[] = ['telegram', 'discord', 'webhook', 'email'];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((r): r is NotifyChannel => allowed.includes(r as NotifyChannel)))];
}

function sanitizeSources(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((r): r is string => typeof r === 'string' && r.trim().length > 0).map((r) => r.trim()))];
}

export async function listWatchers(ownerKey: string): Promise<SearchWatcher[]> {
  await ensureLoaded();
  return store.watchers.filter((w) => w.ownerKey === ownerKey);
}

export async function getWatcher(ownerKey: string, id: string): Promise<SearchWatcher | null> {
  await ensureLoaded();
  return store.watchers.find((w) => w.ownerKey === ownerKey && w.id === id) ?? null;
}

export async function createWatcher(ownerKey: string, input: WatcherInput): Promise<SearchWatcher> {
  await ensureLoaded();
  const now = new Date().toISOString();
  const market = findMarket(input.market)?.code ?? input.market;
  const watcher: SearchWatcher = {
    id: `wtr_${randomUUID().slice(0, 8)}`,
    ownerKey,
    label: (input.label?.trim() || input.query.trim()).slice(0, 120),
    query: input.query.trim().slice(0, 200),
    market,
    minPrice: input.minPrice ?? null,
    maxPrice: input.maxPrice ?? null,
    sources: sanitizeSources(input.sources),
    notifications: sanitizeNotifications(input.notifications),
    enabled: input.enabled ?? true,
    highPriority: input.highPriority ?? false,
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    lastTriggeredAt: null,
    lastError: null,
    seen: [],
  };
  store.watchers.unshift(watcher);
  await persist();
  logEvent('alerts', 'info', `Watcher "${watcher.label}" created.`);
  return watcher;
}

export async function updateWatcher(
  ownerKey: string,
  id: string,
  patch: Partial<WatcherInput>,
): Promise<SearchWatcher | null> {
  await ensureLoaded();
  const watcher = store.watchers.find((w) => w.ownerKey === ownerKey && w.id === id);
  if (!watcher) return null;
  if (patch.label != null) watcher.label = patch.label.trim().slice(0, 120);
  if (patch.query != null) watcher.query = patch.query.trim().slice(0, 200);
  if (patch.market != null) watcher.market = findMarket(patch.market)?.code ?? patch.market;
  if (patch.minPrice !== undefined) watcher.minPrice = patch.minPrice;
  if (patch.maxPrice !== undefined) watcher.maxPrice = patch.maxPrice;
  if (patch.sources !== undefined) watcher.sources = sanitizeSources(patch.sources);
  if (patch.notifications !== undefined) watcher.notifications = sanitizeNotifications(patch.notifications);
  if (patch.enabled !== undefined) watcher.enabled = patch.enabled;
  if (patch.highPriority !== undefined) watcher.highPriority = patch.highPriority;
  watcher.updatedAt = new Date().toISOString();
  await persist();
  return watcher;
}

export async function deleteWatcher(ownerKey: string, id: string): Promise<boolean> {
  await ensureLoaded();
  const before = store.watchers.length;
  store.watchers = store.watchers.filter((w) => !(w.ownerKey === ownerKey && w.id === id));
  if (store.watchers.length === before) return false;
  store.alerts = store.alerts.filter((a) => !(a.ownerKey === ownerKey && a.watcherId === id));
  await persist();
  return true;
}

// ---------- Alerts feed ----------

export async function listAlerts(ownerKey: string, limit = 100): Promise<AlertRecord[]> {
  await ensureLoaded();
  return store.alerts.filter((a) => a.ownerKey === ownerKey).slice(0, Math.max(1, Math.min(limit, 500)));
}

export async function getNotificationSettings(ownerKey: string): Promise<NotificationSettings> {
  await ensureLoaded();
  const stored = store.settings[ownerKey];
  return {
    telegram: { ...EMPTY_SETTINGS.telegram, ...stored?.telegram },
    discord: { ...EMPTY_SETTINGS.discord, ...stored?.discord },
    webhook: { ...EMPTY_SETTINGS.webhook, ...stored?.webhook },
    email: { ...EMPTY_SETTINGS.email, ...stored?.email },
  };
}

export async function setNotificationSettings(
  ownerKey: string,
  patch: Partial<NotificationSettings>,
): Promise<NotificationSettings> {
  await ensureLoaded();
  const current = await getNotificationSettings(ownerKey);
  const next: NotificationSettings = {
    telegram: { ...current.telegram, ...patch.telegram },
    discord: { ...current.discord, ...patch.discord },
    webhook: { ...current.webhook, ...patch.webhook },
    email: { ...current.email, ...patch.email },
  };
  store.settings[ownerKey] = next;
  await persist();
  return next;
}

/** Move an anonymous device's watchers/feed/settings into an account on sign-in. */
export async function migrateAlerts(fromKey: string, toKey: string): Promise<number> {
  if (!fromKey || fromKey === toKey) return 0;
  await ensureLoaded();
  const watchers = store.watchers.filter((w) => w.ownerKey === fromKey);
  if (watchers.length === 0 && !store.settings[fromKey]) return 0;
  for (const w of watchers) w.ownerKey = toKey;
  for (const a of store.alerts) if (a.ownerKey === fromKey) a.ownerKey = toKey;
  if (store.settings[fromKey] && !store.settings[toKey]) store.settings[toKey] = store.settings[fromKey];
  delete store.settings[fromKey];
  await persist();
  return watchers.length;
}

/** Remove everything owned by an owner key (used when an account is deleted). */
export async function purgeAlerts(ownerKey: string): Promise<void> {
  await ensureLoaded();
  const before = store.watchers.length + store.alerts.length + (store.settings[ownerKey] ? 1 : 0);
  store.watchers = store.watchers.filter((w) => w.ownerKey !== ownerKey);
  store.alerts = store.alerts.filter((a) => a.ownerKey !== ownerKey);
  delete store.settings[ownerKey];
  const after = store.watchers.length + store.alerts.length + (store.settings[ownerKey] ? 1 : 0);
  if (after !== before) await persist();
}

// ---------- Notification dispatch ----------

async function postJson(url: string, body: unknown, timeoutMs = 8000): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function formatAlertText(alert: AlertRecord): string {
  const price = alert.listing.price != null ? `${alert.listing.price} ${alert.listing.currency}` : 'price n/a';
  const delta = alert.reason === 'price-drop' && alert.listing.previousPrice != null
    ? ` (was ${alert.listing.previousPrice} ${alert.listing.currency})`
    : '';
  return [
    `🔔 ${alert.watcherLabel}`,
    `${alert.listing.title}`,
    `${price}${delta} · ${alert.listing.source}`,
    alert.listing.listingUrl,
  ].join('\n');
}

/** Best-effort fan-out of one alert to the owner's enabled channels. */
export async function dispatchAlert(alert: AlertRecord): Promise<void> {
  const settings = await getNotificationSettings(alert.ownerKey);
  const watcher = store.watchers.find((w) => w.id === alert.watcherId && w.ownerKey === alert.ownerKey);
  const channels = new Set<NotifyChannel>(watcher?.notifications ?? []);
  const text = formatAlertText(alert);
  const payload = {
    watcher: alert.watcherLabel,
    reason: alert.reason,
    title: alert.listing.title,
    price: alert.listing.price,
    currency: alert.listing.currency,
    source: alert.listing.source,
    url: alert.listing.listingUrl,
    imageUrl: alert.listing.imageUrl,
  };

  const jobs: Array<Promise<unknown>> = [];
  if (channels.has('telegram') && settings.telegram.botToken && settings.telegram.chatId) {
    const url = `https://api.telegram.org/bot${settings.telegram.botToken}/sendMessage`;
    jobs.push(postJson(url, { chat_id: settings.telegram.chatId, text, disable_web_page_preview: false }));
  }
  if (channels.has('discord') && settings.discord.webhookUrl) {
    jobs.push(postJson(settings.discord.webhookUrl, { content: text }));
  }
  if (channels.has('webhook') && settings.webhook.url) {
    jobs.push(postJson(settings.webhook.url, payload));
  }
  // Email requires an SMTP/relay integration; recorded but not sent here.
  if (jobs.length) await Promise.allSettled(jobs);
}

/** Send a synthetic test alert to every configured channel (ignores per-watcher selection). */
export async function testDispatch(ownerKey: string): Promise<{ sent: NotifyChannel[] }> {
  const settings = await getNotificationSettings(ownerKey);
  const sample: AlertRecord = {
    id: `test_${randomUUID().slice(0, 8)}`,
    ownerKey,
    watcherId: 'test',
    watcherLabel: 'Test watcher',
    reason: 'new',
    listing: {
      id: 'test:1',
      source: 'test',
      title: 'Test alert from Fundstück',
      price: 42,
      currency: 'CHF',
      listingUrl: 'https://example.com/test',
      imageUrl: null,
      location: null,
    },
    createdAt: new Date().toISOString(),
  };
  const text = formatAlertText(sample);
  const sent: NotifyChannel[] = [];
  if (settings.telegram.botToken && settings.telegram.chatId) {
    const ok = await postJson(`https://api.telegram.org/bot${settings.telegram.botToken}/sendMessage`, {
      chat_id: settings.telegram.chatId,
      text,
    });
    if (ok) sent.push('telegram');
  }
  if (settings.discord.webhookUrl) {
    if (await postJson(settings.discord.webhookUrl, { content: text })) sent.push('discord');
  }
  if (settings.webhook.url) {
    if (await postJson(settings.webhook.url, sample.listing)) sent.push('webhook');
  }
  return { sent };
}

// ---------- Running watchers ----------

function toAlertListing(listing: NormalizedListing, previousPrice?: number | null): AlertListing {
  return {
    id: listing.id,
    source: listing.source,
    title: listing.title,
    price: listing.price,
    currency: listing.currency,
    listingUrl: listing.listingUrl,
    imageUrl: listing.imageUrl,
    location: listing.location,
    previousPrice,
  };
}

function pushAlert(alert: AlertRecord): void {
  store.alerts.unshift(alert);
  if (store.alerts.length > MAX_ALERTS) store.alerts = store.alerts.slice(0, MAX_ALERTS);
}

/**
 * Re-run a single watcher and record/dispatch alerts for unseen listings and
 * price drops. The first run only seeds the seen set (no alert flood).
 */
export async function runWatcher(
  watcher: SearchWatcher,
  opts: { seedOnly?: boolean } = {},
): Promise<{ alerts: AlertRecord[]; error: string | null }> {
  const isFirstRun = opts.seedOnly ?? (watcher.lastRunAt == null && watcher.seen.length === 0);
  const errors: string[] = [];
  let listings: NormalizedListing[] = [];
  try {
    const query = parseSearchParams({
      q: watcher.query,
      market: watcher.market,
      minPrice: watcher.minPrice ?? undefined,
      maxPrice: watcher.maxPrice ?? undefined,
    });
    const adapters = enabledAdapters(watcher.market).filter(
      (a) => watcher.sources.length === 0 || watcher.sources.includes(a.id),
    );
    if (adapters.length === 0) {
      watcher.lastRunAt = new Date().toISOString();
      watcher.lastError = 'No enabled sources for this market.';
      await persist();
      return { alerts: [], error: watcher.lastError };
    }
    const result = await runSearch(adapters, query);
    listings = result.listings;
    for (const s of result.sources) {
      if (s.status === 'error' || s.status === 'timeout') errors.push(`${s.label}: ${s.status}`);
    }
  } catch (err) {
    watcher.lastRunAt = new Date().toISOString();
    watcher.lastError = err instanceof Error ? err.message : 'Search failed.';
    await persist();
    return { alerts: [], error: watcher.lastError };
  }

  const previouslySeen = new Map(watcher.seen.map((s) => [s.id, s.price]));
  const created: AlertRecord[] = [];
  const now = new Date().toISOString();

  for (const listing of listings) {
    if (listing.price == null) continue;
    const before = previouslySeen.get(listing.id);
    let reason: AlertReason | null = null;
    if (before === undefined) {
      if (!isFirstRun) reason = 'new';
    } else if (before != null && listing.price < before) {
      reason = 'price-drop';
    }
    if (reason) {
      const alert: AlertRecord = {
        id: `alt_${randomUUID().slice(0, 10)}`,
        ownerKey: watcher.ownerKey,
        watcherId: watcher.id,
        watcherLabel: watcher.label,
        reason,
        listing: toAlertListing(listing, reason === 'price-drop' ? before ?? null : null),
        createdAt: now,
      };
      created.push(alert);
      pushAlert(alert);
    }
    previouslySeen.set(listing.id, listing.price);
  }

  // Refresh the bounded seen set (most recent listings win).
  const seen = [...previouslySeen.entries()].slice(-MAX_SEEN).map(([id, price]) => ({ id, price }));
  watcher.seen = seen;
  watcher.lastRunAt = now;
  watcher.lastError = errors.length ? errors.join(', ') : null;
  if (created.length) watcher.lastTriggeredAt = now;
  await persist();

  for (const alert of created) {
    void dispatchAlert(alert).catch(() => {});
  }
  if (created.length) {
    logEvent('alerts', 'ok', `Watcher "${watcher.label}" fired ${created.length} alert(s).`);
  }
  return { alerts: created, error: watcher.lastError };
}

/** Run one watcher on demand (manual "Test" / "Run now"). Seeds on first run. */
export async function runWatcherNow(
  ownerKey: string,
  id: string,
): Promise<{ watcher: SearchWatcher; alerts: AlertRecord[]; error: string | null } | null> {
  const watcher = await getWatcher(ownerKey, id);
  if (!watcher) return null;
  const result = await runWatcher(watcher, { seedOnly: false });
  return { watcher, alerts: result.alerts, error: result.error };
}

// ---------- Scheduler ----------

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let pollMs = 5 * 60_000;

export function alertPollIntervalMs(): number {
  return pollMs;
}

export function startAlertScheduler(intervalMs: number): void {
  pollMs = Math.max(30_000, intervalMs);
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    void tick();
  }, pollMs);
  if (typeof timer.unref === 'function') timer.unref();
  logEvent('alerts', 'info', `Alert scheduler started (every ${Math.round(pollMs / 1000)}s).`);
}

export function stopAlertScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    await ensureLoaded();
    const active = store.watchers.filter((w) => w.enabled);
    for (const watcher of active) {
      try {
        await runWatcher(watcher);
      } catch (err) {
        watcher.lastError = err instanceof Error ? err.message : 'Watcher run failed.';
      }
    }
  } finally {
    ticking = false;
  }
}
