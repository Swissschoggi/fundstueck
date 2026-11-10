import fs from 'node:fs';
import path from 'node:path';
import type { ServerConfig } from '../config.js';
import { Pool } from 'pg';

let cfg: ServerConfig | null = null;
let pool: Pool | null = null;
let ready: Promise<void> | null = null;
let mode: 'postgres' | 'file' = 'file';

export function storageMode(): 'postgres' | 'file' {
  return mode;
}

export async function initStorage(config: ServerConfig): Promise<void> {
  cfg = config;
  if (!config.databaseUrl) {
    mode = 'file';
    fs.mkdirSync(config.dataDir, { recursive: true });
    ready = Promise.resolve();
    return;
  }
  mode = 'postgres';
  pool = new Pool({ connectionString: config.databaseUrl });
  ready = pool
    .query(
      `CREATE TABLE IF NOT EXISTS fundstueck_state (
         key TEXT PRIMARY KEY,
         value JSONB NOT NULL,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    )
    .then(() => undefined);
  await ready;
}

async function ensureReady(): Promise<void> {
  if (ready) await ready;
}

function filePath(key: string): string {
  if (!cfg) throw new Error('Storage is not initialised.');
  return path.join(cfg.dataDir, `${key}.json`);
}

export async function readState<T>(key: string): Promise<T | null> {
  await ensureReady();
  if (mode === 'postgres') {
    const result = await pool!.query('SELECT value FROM fundstueck_state WHERE key = $1', [key]);
    if (result.rows.length === 0) return null;
    return result.rows[0].value as T;
  }
  try {
    const raw = fs.readFileSync(filePath(key), 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeState(key: string, value: unknown): Promise<void> {
  await ensureReady();
  if (mode === 'postgres') {
    await pool!.query(
      `INSERT INTO fundstueck_state (key, value, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
    return;
  }
  const file = filePath(key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export async function closeStorage(): Promise<void> {
  if (pool) await pool.end();
  pool = null;
}
