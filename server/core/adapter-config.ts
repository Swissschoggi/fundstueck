import type { ServerConfig } from '../config.js';
import { readState, writeState } from './storage.js';

export interface AdapterConfig {
  [key: string]: string;
}

export interface AdapterConfigStore {
  [adapterId: string]: AdapterConfig;
}

let store: AdapterConfigStore = {};

export async function initAdapterConfig(cfg: ServerConfig): Promise<void> {
  const parsed = await readState<AdapterConfigStore>('adapter-config');
  store = parsed && typeof parsed === 'object' ? parsed : {};
}

export function getAdapterConfig(adapterId: string): AdapterConfig {
  return { ...(store[adapterId] ?? {}) };
}

export function getAdapterConfigValue(adapterId: string, key: string): string | undefined {
  return store[adapterId]?.[key];
}

export async function setAdapterConfig(adapterId: string, config: AdapterConfig): Promise<void> {
  store[adapterId] = { ...config };
  await persist();
}

export function setAdapterConfigValue(adapterId: string, key: string, value: string): void {
  if (!store[adapterId]) store[adapterId] = {};
  if (value === '') delete store[adapterId][key];
  else store[adapterId][key] = value;
  void persist();
}

async function persist(): Promise<void> {
  try {
    await writeState('adapter-config', store);
  } catch {
    /* best effort */
  }
}
