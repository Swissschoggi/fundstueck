import type {
  AdapterHealthResult,
  AdapterInfo,
  CustomSourceConfig,
  CustomSourceDraft,
  MarketsResponse,
  PluginsResponse,
  SearchResponse,
  ServerEvent,
  SetupResponse,
  SortKey,
  SourceTestResult,
  SystemInfo,
} from './types';

export interface SearchParams {
  q: string;
  market: string;
  sort: SortKey;
  minPrice: number | null;
  maxPrice: number | null;
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

export async function fetchSearch(params: SearchParams): Promise<SearchResponse> {
  const url = new URL('/api/search', window.location.origin);
  url.searchParams.set('q', params.q);
  url.searchParams.set('market', params.market);
  url.searchParams.set('sort', params.sort);
  if (params.minPrice != null) url.searchParams.set('minPrice', String(params.minPrice));
  if (params.maxPrice != null) url.searchParams.set('maxPrice', String(params.maxPrice));

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
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
  const res = await fetch(url);
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  const body = (await res.json()) as { sources: AdapterInfo[] };
  return body.sources;
}

export async function fetchSetup(): Promise<SetupResponse> {
  const res = await fetch('/api/setup');
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  return (await res.json()) as SetupResponse;
}

export async function saveSetup(region: string): Promise<SetupResponse> {
  const res = await fetch('/api/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ region }),
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

export async function checkAdapterHealth(id: string): Promise<AdapterHealthResult> {
  const res = await fetch(`/api/sources/${encodeURIComponent(id)}/health`);
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  return (await res.json()) as AdapterHealthResult;
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
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
}

export async function testSource(id: string): Promise<SourceTestResult> {
  const res = await fetch(`/api/sources/${encodeURIComponent(id)}/test`, { method: 'POST' });
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  return (await res.json()) as SourceTestResult;
}

export async function fetchEvents(limit = 80): Promise<ServerEvent[]> {
  const res = await fetch(`/api/events?limit=${limit}`);
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  const body = (await res.json()) as { events: ServerEvent[] };
  return body.events;
}

export async function fetchSystem(): Promise<SystemInfo> {
  const res = await fetch('/api/system');
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  return (await res.json()) as SystemInfo;
}
