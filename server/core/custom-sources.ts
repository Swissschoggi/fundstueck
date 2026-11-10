import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { ServerConfig } from '../config.js';
import { readState, writeState } from './storage.js';
import { findMarket } from './markets.js';
import { getAdapterConfig } from './adapter-config.js';
import type {
  AdapterConfigField,
  AdapterHealth,
  AdapterSearchParams,
  MarketplaceAdapter,
  NormalizedListing,
} from './types.js';
import { SourceError } from './types.js';
import { asArray, asRecord, str } from '../adapters/scrape.js';

/**
 * Operator-defined sources. Two flavours, both configured at runtime from
 * the settings UI and persisted to DATA_DIR (never bundled with the app):
 *
 * - http-json: call an existing JSON API/crawler and map its fields.
 * - command:   run an external CLI (e.g. a community scraper) and parse its
 *              JSON output. The executable is spawned directly — never
 *              through a shell — so arguments cannot be injected.
 */

export type CustomSourceType = 'http-json' | 'command';
export type CustomOutputFormat = 'auto' | 'ricardo';

export interface FieldMap {
  id?: string;
  title?: string;
  price?: string;
  currency?: string;
  location?: string;
  image?: string;
  url?: string;
  description?: string;
  publishedAt?: string;
}

export interface HttpJsonOptions {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  apiKeyEnv?: string;
  responsePath?: string;
  fields: FieldMap;
  priceFactor: number;
}

export interface CommandOptions {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs: number;
  outputFile?: string;
  format: CustomOutputFormat;
  /** Arguments used by the health check instead of a full search (e.g. ["--version"]). */
  healthArgs?: string[];
}

export interface CustomSourceConfig {
  id: string;
  label: string;
  description: string;
  markets: string[];
  enabled: boolean;
  icon: string;
  type: CustomSourceType;
  http?: HttpJsonOptions;
  command?: CommandOptions;
}

export interface SourceStore {
  sources: CustomSourceConfig[];
}

const STORE_FILE = 'custom-sources.json';
const MAX_SOURCES = 20;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const FIELD_KEYS: (keyof FieldMap)[] = [
  'id',
  'title',
  'price',
  'currency',
  'location',
  'image',
  'url',
  'description',
  'publishedAt',
];

export function customSourcesFile(cfg: ServerConfig): string {
  return path.join(cfg.dataDir, STORE_FILE);
}

export async function loadCustomSources(cfg: ServerConfig): Promise<CustomSourceConfig[]> {
  try {
    const parsed = await readState<Partial<SourceStore>>('custom-sources');
    if (!parsed || !Array.isArray(parsed.sources)) return [];
    return parsed.sources
      .map((item) => validateCustomSource(item, { reservedIds: new Set() }))
      .filter((r): r is { ok: true; value: CustomSourceConfig } => r.ok)
      .map((r) => r.value)
      .slice(0, MAX_SOURCES);
  } catch {
    return [];
  }
}

export async function saveCustomSources(cfg: ServerConfig, sources: CustomSourceConfig[]): Promise<void> {
  await writeState('custom-sources', { sources } satisfies SourceStore);
}

export async function upsertCustomSource(
  cfg: ServerConfig,
  source: CustomSourceConfig,
): Promise<CustomSourceConfig[]> {
  const sources = await loadCustomSources(cfg);
  const index = sources.findIndex((s) => s.id === source.id);
  if (index >= 0) sources[index] = source;
  else sources.push(source);
  await saveCustomSources(cfg, sources.slice(0, MAX_SOURCES));
  return sources;
}

export async function removeCustomSource(cfg: ServerConfig, id: string): Promise<boolean> {
  const sources = await loadCustomSources(cfg);
  const next = sources.filter((s) => s.id !== id);
  if (next.length === sources.length) return false;
  await saveCustomSources(cfg, next);
  return true;
}

export function validateCustomSource(
  input: unknown,
  opts: { reservedIds: Set<string>; currentId?: string },
):
  | { ok: true; value: CustomSourceConfig }
  | { ok: false; error: string } {
  const body = asRecord(input);
  if (!body) return fail('Source config must be a JSON object.');

  const rawId = str(body.id)?.toLowerCase().replace(/[^a-z0-9-]/g, '-') ?? '';
  const id = rawId.replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(id)) {
    return fail('"id" must be 2–40 chars, start with a letter and use a-z, 0-9, "-".');
  }
  if (opts.reservedIds.has(id) && id !== opts.currentId) {
    return fail(`The source id "${id}" is already in use.`);
  }

  const label = str(body.label);
  if (!label || label.length > 80) return fail('"label" is required (max 80 chars).');
  const description = str(body.description) ?? '';
  if (description.length > 600) return fail('"description" must be at most 600 chars.');

  const marketsRaw = Array.isArray(body.markets)
    ? body.markets
    : typeof body.markets === 'string'
      ? body.markets.split(',')
      : [];
  const markets = [
    ...new Set(
      marketsRaw
        .map((m) => (typeof m === 'string' ? m.trim().toUpperCase() : ''))
        .filter((m): m is string => Boolean(findMarket(m))),
    ),
  ];
  if (markets.length === 0) return fail('"markets" must contain at least one market code.');

  const icon = (str(body.icon) ?? 'extension').replace(/[^a-z0-9_]/g, '');
  const type = body.type;
  if (type !== 'http-json' && type !== 'command') {
    return fail('"type" must be "http-json" or "command".');
  }

  const base = {
    id,
    label,
    description,
    markets,
    enabled: body.enabled !== false,
    icon: icon || 'extension',
  };

  if (type === 'http-json') {
    const raw = asRecord(body.http);
    if (!raw) return fail('"http" options are required for http-json sources.');
    const url = str(raw.url);
    if (!url || !/^https?:\/\//i.test(url)) return fail('"http.url" must be an http(s) URL.');
    if (url.length > 2000) return fail('"http.url" is too long.');
    const method = raw.method === 'POST' ? 'POST' : 'GET';
    const headers: Record<string, string> = {};
    const rawHeaders = asRecord(raw.headers);
    if (rawHeaders) {
      for (const [key, value] of Object.entries(rawHeaders)) {
        if (typeof value !== 'string') continue;
        if (!/^[A-Za-z0-9-]{1,80}$/.test(key)) return fail(`Invalid header name "${key}".`);
        if (value.length > 1000) return fail(`Header "${key}" is too long.`);
        headers[key] = value;
      }
      if (Object.keys(headers).length > 20) return fail('Too many custom headers (max 20).');
    }
    const apiKeyEnv = str(raw.apiKeyEnv);
    if (apiKeyEnv && !/^[A-Z][A-Z0-9_]{0,79}$/.test(apiKeyEnv)) {
      return fail('"http.apiKeyEnv" must look like an environment variable name.');
    }
    const responsePath = str(raw.responsePath);
    const fields = asRecord(raw.fields) ?? {};
    const mapped: FieldMap = {};
    for (const key of FIELD_KEYS) {
      const value = str(fields[key]);
      if (value) {
        if (value.length > 200) return fail(`Field mapping "${key}" is too long.`);
        mapped[key] = value;
      }
    }
    const factorRaw = Number(raw.priceFactor ?? 1);
    const priceFactor = Number.isFinite(factorRaw) && factorRaw > 0 && factorRaw <= 1000 ? factorRaw : 1;
    return {
      ok: true,
      value: {
        ...base,
        type,
        http: { url, method, headers, apiKeyEnv, responsePath, fields: mapped, priceFactor },
      },
    };
  }

  const raw = asRecord(body.command);
  if (!raw) return fail('"command" options are required for command sources.');
  const command = str(raw.command);
  if (!command || command.length > 500 || /[\x00-\x1f]/.test(command)) {
    return fail('"command.command" is required (max 500 chars, no control characters).');
  }
  const args = Array.isArray(raw.args)
    ? raw.args.filter((a): a is string => typeof a === 'string').map((a) => a.slice(0, 500))
    : [];
  if (args.length > 30) return fail('Too many command arguments (max 30).');
  const cwd = str(raw.cwd);
  if (cwd && cwd.length > 1000) return fail('"command.cwd" is too long.');
  const timeoutRaw = Number(raw.timeoutMs ?? 60000);
  const timeoutMs = Number.isFinite(timeoutRaw)
    ? Math.min(Math.max(Math.round(timeoutRaw), 1000), 300000)
    : 60000;
  const outputFile = str(raw.outputFile);
  if (outputFile && outputFile.length > 1000) return fail('"command.outputFile" is too long.');
  const format: CustomOutputFormat = raw.format === 'ricardo' ? 'ricardo' : 'auto';
  const healthArgs = Array.isArray(raw.healthArgs)
    ? raw.healthArgs.filter((a): a is string => typeof a === 'string').map((a) => a.slice(0, 500)).slice(0, 10)
    : undefined;

  return {
    ok: true,
    value: {
      ...base,
      type,
      command: { command, args, cwd, timeoutMs, outputFile, format, healthArgs },
    },
  };
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/* ------------------------------------------------------------------ */
/* Adapters                                                            */
/* ------------------------------------------------------------------ */

class CustomHttpAdapter implements MarketplaceAdapter {
  readonly id: string;
  readonly label: string;
  readonly mode = 'live' as const;
  readonly description: string;
  readonly auth = 'Custom HTTP JSON';
  readonly envVars: string[];
  readonly capabilities: string[];
  readonly icon: string;
  readonly markets: string[];
  readonly docsUrl?: string;

  readonly configFields: AdapterConfigField[] = [
    {
      key: 'apiKey',
      label: 'API key / token (stored securely)',
      secret: true,
      placeholder: 'paste token here (overrides the env var above)',
      help: 'Stored in data/adapter-config.json (git-ignored). Takes precedence over the env var.',
    },
  ];

  constructor(
    private readonly cfg: CustomSourceConfig,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    const http = cfg.http;
    if (!http) throw new Error('missing http options');
    this.id = cfg.id;
    this.label = cfg.label;
    this.description = cfg.description;
    this.icon = cfg.icon;
    this.markets = cfg.markets;
    this.envVars = http.apiKeyEnv ? [http.apiKeyEnv] : [];
    this.capabilities = ['User-configured', 'HTTP JSON'];
  }

  isEnabled(): boolean {
    return this.cfg.enabled !== false && Boolean(this.cfg.http?.url);
  }

  disabledReason(): string | null {
    if (!this.cfg.http?.url) return 'No endpoint configured.';
    if (this.cfg.enabled === false) return 'Disabled in configuration.';
    return null;
  }

  async search(params: AdapterSearchParams): Promise<NormalizedListing[]> {
    const http = this.cfg.http;
    if (!http) throw new SourceError(`${this.id} has no HTTP configuration.`, 'RESPONSE');
    const limit = Math.max(1, Math.min(params.limit, 50));
    const market = params.market ?? this.markets[0] ?? '';
    const url = http.url
      .replaceAll('{query}', encodeURIComponent(params.q))
      .replaceAll('{limit}', String(limit))
      .replaceAll('{market}', encodeURIComponent(market));

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...http.headers,
    };
    const storedToken = getAdapterConfig(this.id).apiKey;
    if (storedToken) {
      headers.Authorization = `Bearer ${storedToken}`;
    } else if (http.apiKeyEnv) {
      const token = this.env[http.apiKeyEnv];
      if (!token) {
        throw new SourceError(`${this.id} is missing ${http.apiKeyEnv}.`, 'AUTH');
      }
      headers.Authorization = `Bearer ${token}`;
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: http.method,
        headers,
        body:
          http.method === 'POST'
            ? JSON.stringify({ query: params.q, q: params.q, limit, market })
            : undefined,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new SourceError(`${this.label} request failed: ${(err as Error).message}`, 'NETWORK');
    }
    if (res.status === 401 || res.status === 403) {
      throw new SourceError(`${this.label} rejected the credentials (HTTP ${res.status}).`, 'AUTH');
    }
    if (!res.ok) {
      throw new SourceError(`${this.label} returned HTTP ${res.status}.`, 'UPSTREAM', res.status);
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      throw new SourceError(`${this.label} did not return valid JSON.`, 'RESPONSE');
    }
    const items = findItems(payload, http.responsePath);
    if (!items) {
      throw new SourceError(`${this.label} response contains no listing array.`, 'RESPONSE');
    }
    return mapItems(items.slice(0, limit), http.fields, {
      source: this.id,
      markets: this.markets,
      currency: findMarket(this.markets[0] ?? '')?.currency ?? 'CHF',
      priceFactor: http.priceFactor,
      format: 'auto',
    });
  }

  async healthCheck(): Promise<AdapterHealth> {
    const started = Date.now();
    try {
      const listings = await this.search({ q: 'velo', limit: 1 });
      return {
        ok: true,
        latencyMs: Date.now() - started,
        message: `Endpoint reachable (${listings.length} sample result${listings.length === 1 ? '' : 's'}).`,
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: err instanceof Error ? err.message : 'Health check failed.',
      };
    }
  }
}

class CustomCommandAdapter implements MarketplaceAdapter {
  readonly id: string;
  readonly label: string;
  readonly mode = 'live' as const;
  readonly description: string;
  readonly auth = 'External command';
  readonly envVars: string[] = [];
  readonly capabilities: string[];
  readonly icon: string;
  readonly markets: string[];
  readonly docsUrl?: string;
  readonly timeoutMs: number;
  private lastRunAt = 0;

  constructor(private readonly cfg: CustomSourceConfig) {
    const command = cfg.command;
    if (!command) throw new Error('missing command options');
    this.id = cfg.id;
    this.label = cfg.label;
    this.description = cfg.description;
    this.icon = cfg.icon;
    this.markets = cfg.markets;
    this.timeoutMs = cfg.command?.timeoutMs ?? 60000;
    this.capabilities = ['User-configured', 'External CLI'];
  }

  isEnabled(): boolean {
    const command = this.cfg.command;
    return (
      this.cfg.enabled !== false &&
      Boolean(command?.command) &&
      findExecutable(command!.command) != null
    );
  }

  disabledReason(): string | null {
    const command = this.cfg.command;
    if (!command?.command) return 'No command configured.';
    if (this.cfg.enabled === false) return 'Disabled in configuration.';
    if (!findExecutable(command.command)) {
      return `Executable not found: ${command.command} — install it or adjust the command.`;
    }
    return null;
  }

  async search(params: AdapterSearchParams): Promise<NormalizedListing[]> {
    const command = this.cfg.command;
    if (!command) throw new SourceError(`${this.id} has no command.`, 'RESPONSE');
    if (!findExecutable(command.command)) {
      throw new SourceError(`Executable not found: ${command.command}`, 'NETWORK');
    }

    const wait = 1000 - (Date.now() - this.lastRunAt);
    if (wait > 0) await sleep(wait);
    this.lastRunAt = Date.now();

    const limit = Math.max(1, Math.min(params.limit, 50));
    const tmp = path.join(os.tmpdir(), `fundstueck-${this.id}-${randomUUID()}`);
    const replace = (value: string) =>
      value
        .replaceAll('{query}', params.q)
        .replaceAll('{limit}', String(limit))
        .replaceAll('{market}', params.market ?? this.markets[0] ?? '')
        .replaceAll('{tmp}', tmp);

    const args = command.args.map(replace);
    const outputFile = command.outputFile ? replace(command.outputFile) : null;

    const result = await runCommand(command.command, args, {
      cwd: command.cwd,
      timeoutMs: command.timeoutMs,
      env: {
        ...process.env,
        FUNDSTUECK_QUERY: params.q,
        FUNDSTUECK_LIMIT: String(limit),
        FUNDSTUECK_MARKET: params.market ?? this.markets[0] ?? '',
      },
    });

    try {
      let raw: string;
      if (outputFile) {
        try {
          raw = await fs.promises.readFile(outputFile, 'utf8');
        } catch {
          throw new SourceError(
            `${this.label} exited without writing its output file.`,
            'RESPONSE',
          );
        }
        if (raw.length > MAX_RESPONSE_BYTES) {
          throw new SourceError(`${this.label} output exceeds 5 MB.`, 'RESPONSE');
        }
      } else {
        raw = result.stdout;
        if (!raw.trim()) {
          throw new SourceError(`${this.label} produced no output.`, 'RESPONSE');
        }
      }

      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new SourceError(`${this.label} output is not valid JSON.`, 'RESPONSE');
      }
      const items = findItems(payload, undefined);
      if (!items) {
        throw new SourceError(`${this.label} output contains no listing array.`, 'RESPONSE');
      }
      return mapItems(items.slice(0, limit), {}, {
        source: this.id,
        markets: this.markets,
        currency: findMarket(this.markets[0] ?? '')?.currency ?? 'CHF',
        priceFactor: 1,
        format: command.format,
      });
    } finally {
      if (outputFile) {
        void fs.promises.unlink(outputFile).catch(() => {});
      }
    }
  }

  async healthCheck(): Promise<AdapterHealth> {
    const command = this.cfg.command;
    if (!command) return { ok: false, latencyMs: 0, message: 'No command configured.' };
    const started = Date.now();
    const resolved = findExecutable(command.command);
    if (!resolved) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: `Executable not found: ${command.command}`,
      };
    }
    let preflight = '';
    // Quick preflight (e.g. --version) to confirm the executable runs.
    if (command.healthArgs && command.healthArgs.length > 0) {
      const replace = (value: string) =>
        value
          .replaceAll('{query}', 'velo')
          .replaceAll('{limit}', '1')
          .replaceAll('{market}', this.markets[0] ?? '')
          .replaceAll('{tmp}', path.join(os.tmpdir(), `fundstueck-health-${this.id}`));
      const args = command.healthArgs.map(replace);
      try {
        const result = await runCommand(command.command, args, {
          cwd: command.cwd,
          timeoutMs: Math.min(command.timeoutMs, 10000),
          env: { ...process.env },
        });
        preflight = result.stdout.trim().split('\n')[0]?.trim() ?? '';
      } catch (err) {
        return {
          ok: false,
          latencyMs: Date.now() - started,
          message: err instanceof Error ? err.message : 'Health check failed.',
        };
      }
    }

    // Real search probe: runs the configured command end-to-end, but capped
    // at 30 s so a slow first run (browser download, Cloudflare) does not
    // hang the settings page.
    const commandRef = this.cfg.command!;
    const originalTimeout = commandRef.timeoutMs;
    commandRef.timeoutMs = Math.min(originalTimeout, 30000);
    try {
      const listings = await this.search({ q: 'velo', limit: 1, market: this.markets[0] });
      const prefix = preflight ? `${preflight} · ` : '';
      return {
        ok: true,
        latencyMs: Date.now() - started,
        message: `${prefix}Search probe passed — ${listings.length} listing(s) returned.`,
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: err instanceof Error ? err.message : 'Health check failed.',
      };
    } finally {
      commandRef.timeoutMs = originalTimeout;
    }
  }
}

export function createCustomAdapter(cfg: CustomSourceConfig): MarketplaceAdapter {
  return cfg.type === 'command'
    ? new CustomCommandAdapter(cfg)
    : new CustomHttpAdapter(cfg);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function findItems(payload: unknown, responsePath?: string): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  const root = asRecord(payload);
  if (!root) return null;

  if (responsePath) {
    const picked = pickPath(payload, responsePath);
    if (Array.isArray(picked)) return picked;
    const rec = asRecord(picked);
    if (rec) {
      for (const key of ['listings', 'items', 'results', 'data']) {
        if (Array.isArray(rec[key])) return rec[key] as unknown[];
      }
    }
    return null;
  }

  for (const key of ['listings', 'items', 'results', 'data', 'hits', 'rows', 'products']) {
    const value = root[key];
    if (Array.isArray(value)) return value;
    const rec = asRecord(value);
    if (rec) {
      for (const nested of ['listings', 'items', 'results', 'edges']) {
        if (Array.isArray(rec[nested])) return rec[nested] as unknown[];
      }
    }
  }
  return null;
}

function mapItems(
  items: unknown[],
  fields: FieldMap,
  opts: {
    source: string;
    markets: string[];
    currency: string;
    priceFactor: number;
    format: CustomOutputFormat;
  },
): NormalizedListing[] {
  const now = new Date().toISOString();
  const listings: NormalizedListing[] = [];

  for (const rawItem of items) {
    const node = asRecord(rawItem);
    if (!node) continue;
    const item = asRecord(node.node) ?? asRecord(node.listing) ?? node;

    const id =
      pickString(item, fields.id) ??
      firstString(item, ['id', 'itemId', 'listingId', 'sku']) ??
      firstString(item, ['url', 'listingUrl', 'link']);
    const title = pickString(item, fields.title) ?? firstString(item, ['title', 'name']);
    const url = pickString(item, fields.url) ?? firstString(item, ['url', 'listingUrl', 'link', 'permalink']);
    if (!id || !title || !url) continue;
    if (!/^https?:\/\//i.test(url)) continue;

    const currency =
      pickString(item, fields.currency) ??
      (opts.format === 'ricardo' ? 'CHF' : undefined) ??
      opts.currency;
    const priceRaw =
      pickValue(item, fields.price) ??
      firstValue(item, ['price', 'buyNowPrice', 'amount', 'value']);
    const price = parsePrice(priceRaw);
    const image =
      pickString(item, fields.image) ??
      firstString(item, ['image', 'imageUrl', 'thumbnail', 'thumbnailUrl']) ??
      firstStringFromArray(item, ['images']);
    const location =
      pickString(item, fields.location) ??
      (opts.format === 'ricardo'
        ? [str(item.location_city), str(item.location_zip)].filter(Boolean).join(' ') || null
        : locationFrom(item)) ??
      null;
    const publishedAt =
      pickString(item, fields.publishedAt) ??
      firstString(item, ['publishedAt', 'published_at', 'availability_ends', 'date']) ??
      null;

    listings.push({
      id: `${opts.source}:${id}`,
      source: opts.source,
      sourceListingId: id,
      title,
      description: pickString(item, fields.description) ?? str(item.description) ?? '',
      price: price == null ? null : roundMoney(price * opts.priceFactor),
      currency: currency.toUpperCase(),
      location,
      imageUrl: image ?? null,
      listingUrl: url,
      publishedAt: isIsoDate(publishedAt) ? publishedAt : null,
      fetchedAt: now,
    });
  }
  return listings;
}

function locationFrom(item: Record<string, unknown>): string | null {
  const raw = item.location;
  if (typeof raw === 'string') return raw || null;
  const rec = asRecord(raw);
  if (rec) {
    const city = str(rec.city) ?? str(rec.name);
    const zip = str(rec.zip) ?? str(rec.postalCode);
    const joined = [city, zip].filter(Boolean).join(' ');
    return joined || null;
  }
  return null;
}

function pickPath(value: unknown, dotted: string): unknown {
  let current: unknown = value;
  for (const part of dotted.split('.').filter(Boolean)) {
    const rec = asRecord(current);
    if (!rec) return undefined;
    current = rec[part];
  }
  return current;
}

function pickValue(item: Record<string, unknown>, field?: string): unknown {
  return field ? pickPath(item, field) : undefined;
}

function pickString(item: Record<string, unknown>, field?: string): string | undefined {
  return field ? str(pickPath(item, field)) : undefined;
}

function firstValue(item: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = item[key];
    if (value != null) return value;
  }
  return undefined;
}

function firstString(item: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = str(item[key]);
    if (value) return value;
  }
  return undefined;
}

function firstStringFromArray(item: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = asArray(item[key])[0];
    const found = str(value);
    if (found) return found;
  }
  return undefined;
}

function parsePrice(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    let normalized = value.replace(/[^0-9.,-]/g, '');
    const lastComma = normalized.lastIndexOf(',');
    const lastDot = normalized.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      normalized =
        lastComma > lastDot
          ? normalized.replace(/\./g, '').replace(',', '.')
          : normalized.replace(/,/g, '');
    } else if (lastComma >= 0) {
      const [, fraction = ''] = normalized.split(',');
      normalized =
        fraction.length > 0 && fraction.length <= 2
          ? normalized.replace(',', '.')
          : normalized.replace(/,/g, '');
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const rec = asRecord(value);
  if (rec) {
    const amount = rec.amount ?? rec.value ?? rec.price;
    if (amount != null) return parsePrice(amount);
  }
  return null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function isIsoDate(value: string | null): value is string {
  return value != null && !Number.isNaN(Date.parse(value));
}

function findExecutable(command: string): string | null {
  if (command.includes('/') || command.includes('\\')) {
    return fs.existsSync(command) ? command : null;
  }
  const pathEnv = process.env.PATH ?? '';
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface CommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * Pick the most useful line(s) out of a failed command's stderr.
 *
 * Browser-automation CLIs (Playwright, camoufox, ...) commonly print several
 * lines of process lifecycle/cleanup logging (`<launching>`, `<gracefully
 * close start/end>`, ...) *after* the actual error, so naively keeping only
 * the last line — as this used to do — surfaces the cleanup noise instead of
 * the failure. Prefer lines that look like a genuine error; fall back to the
 * tail of the output when nothing matches.
 */
function extractErrorDetail(stderr: string): string {
  const lines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return '';

  const errorish = lines.filter((line) =>
    /\b(err(or)?|exception|traceback|fail(ed|ure)?|eperm|enoent|enoexec|cannot|could not|no such file)\b/i.test(
      line,
    ),
  );
  const picked = (errorish.length > 0 ? errorish : lines).slice(-3);
  return picked.join(' | ').slice(0, 500);
}

function runCommand(
  command: string,
  args: string[],
  opts: { cwd?: string; timeoutMs: number; env: NodeJS.ProcessEnv },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;

    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() =>
        reject(new SourceError(`Command timed out after ${opts.timeoutMs}ms.`, 'NETWORK')),
      );
    }, opts.timeoutMs);

    const collect = (chunk: Buffer, target: 'stdout' | 'stderr') => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_RESPONSE_BYTES) {
        child.kill('SIGKILL');
        finish(() => reject(new SourceError('Command output exceeds 5 MB.', 'RESPONSE')));
        return;
      }
      if (target === 'stdout') stdout += chunk.toString('utf8');
      else stderr += chunk.toString('utf8');
    };

    child.stdout.on('data', (chunk: Buffer) => collect(chunk, 'stdout'));
    child.stderr.on('data', (chunk: Buffer) => collect(chunk, 'stderr'));
    child.on('error', (err) => {
      finish(() => reject(new SourceError(`Could not run command: ${err.message}`, 'NETWORK')));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        const detail = extractErrorDetail(stderr);
        finish(() =>
          reject(
            new SourceError(
              `Command exited with code ${code ?? '?'}${detail ? `: ${detail}` : ''}.`,
              'UPSTREAM',
            ),
          ),
        );
        return;
      }
      finish(() => resolve({ stdout, stderr, code }));
    });
  });
}
