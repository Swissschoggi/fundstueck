import { getDeviceId } from './device';
import type {
  AdapterHealthResult,
  AdapterInfo,
  CustomSourceConfig,
  CustomSourceDraft,
  MarketsResponse,
  PluginsResponse,
  RegistryCountry,
  RegistryCountryResponse,
  RegistryCountriesResponse,
  SearchResponse,
  ServerEvent,
  SetupResponse,
  SortKey,
  SourceTestResult,
  SystemInfo,
  SearchWatcher,
  AlertRecord,
  NotificationSettings,
  NotifyChannel,
  EngineSettings,
  PriceHistoryResponse,
} from './types';

export interface SearchParams {
  q: string;
  market: string;
  sort: SortKey;
  minPrice: number | null;
  maxPrice: number | null;
  category?: string | null;
  gender?: string | null;
  size?: string | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function fetchSearch(params: SearchParams, signal?: AbortSignal): Promise<SearchResponse> {
  const url = new URL('/api/search', window.location.origin);
  url.searchParams.set('q', params.q);
  url.searchParams.set('market', params.market);
  url.searchParams.set('sort', params.sort);
  if (params.minPrice != null) url.searchParams.set('minPrice', String(params.minPrice));
  if (params.maxPrice != null) url.searchParams.set('maxPrice', String(params.maxPrice));
  if (params.category) url.searchParams.set('category', params.category);
  if (params.gender) url.searchParams.set('gender', params.gender);
  if (params.size) url.searchParams.set('size', params.size);
  url.searchParams.set('device', getDeviceId());

  const res = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'include', signal });
  if (!res.ok) {
    let message = `Search failed (HTTP ${res.status})`;
    let code: string | undefined;
    try {
      const body = await res.json();
      if (body?.error?.message) message = body.error.message;
      if (typeof body?.error?.code === 'string') code = body.error.code;
    } catch {
      /* keep default message */
    }
    throw new ApiError(message, res.status, code);
  }
  return (await res.json()) as SearchResponse;
}

export async function fetchSources(market?: string): Promise<AdapterInfo[]> {
  const url = new URL('/api/sources', window.location.origin);
  if (market) url.searchParams.set('market', market);
  url.searchParams.set('device', getDeviceId());
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  const body = (await res.json()) as { sources: AdapterInfo[] };
  return body.sources;
}

export async function fetchSetup(): Promise<SetupResponse> {
  const res = await fetch('/api/setup');
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  return (await res.json()) as SetupResponse;
}

export async function saveSetup(region: string, countries?: string[]): Promise<SetupResponse> {
  const res = await fetch('/api/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ region, countries }),
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error?.message) message = body.error.message;
    } catch {
      /* keep default */
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as SetupResponse;
}

export async function fetchMarkets(): Promise<MarketsResponse> {
  const res = await fetch('/api/markets');
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  return (await res.json()) as MarketsResponse;
}

export async function setAdapterEnabled(id: string, enabled: boolean): Promise<AdapterInfo> {
  const res = await fetch(`/api/sources/${encodeURIComponent(id)}/enabled`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  const body = (await res.json()) as { source: AdapterInfo };
  return body.source;
}

/** Switch a source on/off for the current account (or device when signed out). */
export async function setSourcePreference(id: string, enabled: boolean): Promise<void> {
  const res = await fetch(`/api/preferences/sources/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ enabled, device: getDeviceId() }),
  });
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
}

export async function checkAdapterHealth(id: string): Promise<AdapterHealthResult> {
  const res = await fetch(`/api/sources/${encodeURIComponent(id)}/health`);
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  return (await res.json()) as AdapterHealthResult;
}

export async function fetchAdapterConfig(id: string): Promise<{ fields: AdapterInfo['configFields']; values: Record<string, string>; hasSecret: Record<string, boolean> }> {
  const res = await fetch(`/api/sources/${encodeURIComponent(id)}/config`);
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  return (await res.json()) as { fields: AdapterInfo['configFields']; values: Record<string, string>; hasSecret: Record<string, boolean> };
}

export async function saveAdapterConfig(id: string, values: Record<string, string>): Promise<void> {
  const res = await fetch(`/api/sources/${encodeURIComponent(id)}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(values),
  });
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
}

export async function fetchPlugins(): Promise<PluginsResponse> {
  const res = await fetch('/api/plugins');
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  return (await res.json()) as PluginsResponse;
}

export async function reloadPlugins(): Promise<PluginsResponse> {
  const res = await fetch('/api/plugins/reload', { method: 'POST' });
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  return fetchPlugins();
}

export async function saveCustomSource(
  draft: CustomSourceDraft,
): Promise<{ customSource: CustomSourceConfig; source: AdapterInfo }> {
  const res = await fetch('/api/custom-sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    let code: string | undefined;
    try {
      const body = await res.json();
      if (body?.error?.message) message = body.error.message;
      if (typeof body?.error?.code === 'string') code = body.error.code;
    } catch {
      /* keep default */
    }
    throw new ApiError(message, res.status, code);
  }
  return (await res.json()) as { customSource: CustomSourceConfig; source: AdapterInfo };
}

export async function deleteCustomSource(id: string): Promise<void> {
  const res = await fetch(`/api/custom-sources/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error?.message) message = body.error.message;
    } catch {
      /* keep default */
    }
    throw new ApiError(message, res.status);
  }
}

export async function testSource(id: string): Promise<SourceTestResult> {
  const res = await fetch(`/api/sources/${encodeURIComponent(id)}/test`, { method: 'POST' });
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  return (await res.json()) as SourceTestResult;
}

export async function fetchRegistryCountries(): Promise<RegistryCountry[]> {
  const res = await fetch('/api/registry/countries');
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  const body = (await res.json()) as RegistryCountriesResponse;
  return body.countries;
}

export async function fetchRegistryCountry(code: string): Promise<RegistryCountryResponse> {
  const res = await fetch(`/api/registry/countries/${encodeURIComponent(code)}/marketplaces`);
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  return (await res.json()) as RegistryCountryResponse;
}

export async function saveRegistryEnabled(code: string, enabled: string[]): Promise<string[]> {
  const res = await fetch(`/api/registry/enabled/${encodeURIComponent(code)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  const body = (await res.json()) as { enabled: string[] };
  return body.enabled;
}

export interface StoredFavorite {
  id: string;
  source: string;
  title: string;
  price: number | null;
  currency: string;
  listingUrl: string;
  imageUrl: string | null;
  savedAt: string;
}

export async function fetchFavorites(device: string): Promise<StoredFavorite[]> {
  const res = await fetch(`/api/favorites?device=${encodeURIComponent(device)}`, { credentials: 'include' });
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  const body = (await res.json()) as { favorites: StoredFavorite[] };
  return body.favorites ?? [];
}

export async function saveFavorite(device: string, listing: {
  id: string; source: string; title: string; price: number | null; currency: string; listingUrl: string; imageUrl: string | null;
}): Promise<void> {
  const res = await fetch('/api/favorites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ device, listing }),
  });
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
}

export async function deleteFavorite(device: string, listingId: string): Promise<void> {
  const res = await fetch('/api/favorites', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ device, listingId }),
  });
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
}

export async function fetchEvents(limit = 80): Promise<ServerEvent[]> {
  const res = await fetch(`/api/events?limit=${limit}`);
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  const body = (await res.json()) as { events: ServerEvent[] };
  return body.events;
}

export async function fetchAvailableAdapters(): Promise<AdapterInfo[]> {
  const res = await fetch('/api/adapters/available');
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  const body = (await res.json()) as { adapters: AdapterInfo[] };
  return body.adapters;
}

export async function installAdapter(id: string): Promise<AdapterInfo> {
  const res = await fetch(`/api/adapters/${encodeURIComponent(id)}/install`, { method: 'POST' });
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  const body = (await res.json()) as { adapter: AdapterInfo };
  return body.adapter;
}

export async function uninstallAdapter(id: string): Promise<void> {
  const res = await fetch(`/api/adapters/${encodeURIComponent(id)}/uninstall`, { method: 'POST' });
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
}

export async function fetchSystem(): Promise<SystemInfo> {
  const res = await fetch('/api/system');
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  return (await res.json()) as SystemInfo;
}

export async function fetchListingHistory(id: string): Promise<PriceHistoryResponse> {
  const res = await fetch(`/api/listings/${encodeURIComponent(id)}/history`);
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  return (await res.json()) as PriceHistoryResponse;
}

export async function fetchEngineSettings(): Promise<{ settings: EngineSettings; alertPollMs: number }> {
  const res = await fetch('/api/engine/settings');
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  return (await res.json()) as { settings: EngineSettings; alertPollMs: number };
}

export async function saveEngineSettings(patch: Partial<EngineSettings>): Promise<EngineSettings> {
  const res = await fetch('/api/engine/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
  const body = (await res.json()) as { settings: EngineSettings };
  return body.settings;
}

// ---------- Saved searches / alert watchers ----------

export interface WatcherDraft {
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

function withDevice(path: string, device: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}device=${encodeURIComponent(device)}`;
}

export async function fetchWatchers(device: string): Promise<SearchWatcher[]> {
  const res = await fetch(withDevice('/api/alerts/watchers', device), { credentials: 'include' });
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  const body = (await res.json()) as { watchers: SearchWatcher[] };
  return body.watchers ?? [];
}

export async function createWatcher(device: string, draft: WatcherDraft): Promise<SearchWatcher> {
  const res = await fetch('/api/alerts/watchers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ ...draft, device }),
  });
  if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
  const body = (await res.json()) as { watcher: SearchWatcher };
  return body.watcher;
}

export async function updateWatcher(
  device: string,
  id: string,
  patch: Partial<WatcherDraft>,
): Promise<SearchWatcher> {
  const res = await fetch(`/api/alerts/watchers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ ...patch, device }),
  });
  if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
  const body = (await res.json()) as { watcher: SearchWatcher };
  return body.watcher;
}

export async function deleteWatcher(device: string, id: string): Promise<void> {
  const res = await fetch(`/api/alerts/watchers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ device }),
  });
  if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
}

export async function runWatcherNow(device: string, id: string): Promise<{ watcher: SearchWatcher; alerts: AlertRecord[]; error: string | null }> {
  const res = await fetch(`/api/alerts/watchers/${encodeURIComponent(id)}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ device }),
  });
  if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
  return (await res.json()) as { watcher: SearchWatcher; alerts: AlertRecord[]; error: string | null };
}

export async function fetchAlerts(device: string, limit = 100): Promise<AlertRecord[]> {
  const res = await fetch(withDevice(`/api/alerts?limit=${limit}`, device), { credentials: 'include' });
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  const body = (await res.json()) as { alerts: AlertRecord[] };
  return body.alerts ?? [];
}

export async function fetchNotificationSettings(device: string): Promise<NotificationSettings> {
  const res = await fetch(withDevice('/api/alerts/settings', device), { credentials: 'include' });
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  const body = (await res.json()) as { settings: NotificationSettings };
  return body.settings;
}

export async function saveNotificationSettings(
  device: string,
  settings: NotificationSettings,
): Promise<NotificationSettings> {
  const res = await fetch('/api/alerts/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ device, settings }),
  });
  if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
  const body = (await res.json()) as { settings: NotificationSettings };
  return body.settings;
}

export async function testNotificationChannels(device: string): Promise<{ sent: NotifyChannel[] }> {
  const res = await fetch('/api/alerts/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ device }),
  });
  if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
  return (await res.json()) as { sent: NotifyChannel[] };
}

async function errorMessage(res: Response): Promise<string> {
  let message = `HTTP ${res.status}`;
  try {
    const body = await res.json();
    if (body?.error?.message) message = body.error.message;
  } catch {
    /* keep default */
  }
  return message;
}
