import fs from 'node:fs';
import path from 'node:path';
import type { ServerConfig } from '../config.js';

export interface AdapterConfig {
  [key: string]: string;
}

export interface AdapterConfigStore {
  [adapterId: string]: AdapterConfig;
}

let store: AdapterConfigStore = {};
let storeFile: string | null = null;

export function initAdapterConfig(cfg: ServerConfig): void {
  storeFile = path.join(cfg.dataDir, 'adapter-config.json');
  try {
    const raw = fs.readFileSync(storeFile, 'utf8');
    const parsed = JSON.parse(raw) as AdapterConfigStore;
    if (parsed && typeof parsed === 'object') store = parsed;
  } catch {
    store = {};
  }
}

export function getAdapterConfig(adapterId: string): AdapterConfig {
  return { ...(store[adapterId] ?? {}) };
}

export function getAdapterConfigValue(adapterId: string, key: string): string | undefined {
  return store[adapterId]?.[key];
}

export function setAdapterConfig(adapterId: string, config: AdapterConfig): void {
  store[adapterId] = { ...config };
  persist();
}

export function setAdapterConfigValue(adapterId: string, key: string, value: string): void {
  if (!store[adapterId]) store[adapterId] = {};
  if (value === '') delete store[adapterId][key];
  else store[adapterId][key] = value;
  persist();
}

function persist(): void {
  if (!storeFile) return;
  try {
    fs.mkdirSync(path.dirname(storeFile), { recursive: true });
    fs.writeFileSync(storeFile, JSON.stringify(store, null, 2));
  } catch {
    /* best effort */
  }
}
