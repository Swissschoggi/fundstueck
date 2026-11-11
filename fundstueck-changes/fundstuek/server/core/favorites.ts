import type { ServerConfig } from '../config.js';
import { readState, writeState } from './storage.js';
import type { NormalizedListing } from './types.js';

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

interface FavoritesStore {
  [deviceId: string]: StoredFavorite[];
}

let cache: FavoritesStore = {};

export async function initFavorites(_cfg: ServerConfig): Promise<void> {
  const parsed = await readState<FavoritesStore>('favorites');
  cache = parsed && typeof parsed === 'object' ? parsed : {};
}

export function listFavorites(deviceId: string): StoredFavorite[] {
  return [...(cache[deviceId] ?? [])];
}

export async function addFavorite(deviceId: string, fav: StoredFavorite): Promise<void> {
  const list = cache[deviceId] ?? [];
  const idx = list.findIndex((f) => f.id === fav.id);
  if (idx >= 0) list[idx] = fav;
  else list.unshift(fav);
  cache[deviceId] = list.slice(0, 500);
  await writeState('favorites', cache);
}

export async function removeFavorite(deviceId: string, listingId: string): Promise<void> {
  const list = cache[deviceId] ?? [];
  cache[deviceId] = list.filter((f) => f.id !== listingId);
  await writeState('favorites', cache);
}

/**
 * Move an anonymous device's saved items into an account on sign-in.
 * Items are merged by listing id (newest save wins) and the device bucket is
 * cleared so the same items are not migrated twice.
 */
export async function migrateFavorites(fromKey: string, toKey: string): Promise<number> {
  if (!fromKey || fromKey === toKey) return 0;
  const incoming = cache[fromKey] ?? [];
  if (incoming.length === 0) return 0;
  const byId = new Map<string, StoredFavorite>();
  for (const f of [...(cache[toKey] ?? []), ...incoming]) {
    const existing = byId.get(f.id);
    if (!existing || Date.parse(f.savedAt) > Date.parse(existing.savedAt)) byId.set(f.id, f);
  }
  cache[toKey] = [...byId.values()]
    .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
    .slice(0, 500);
  delete cache[fromKey];
  await writeState('favorites', cache);
  return incoming.length;
}

/** Remove everything saved under an owner key (used when an account is deleted). */
export async function purgeFavorites(ownerKey: string): Promise<void> {
  if (!(ownerKey in cache)) return;
  delete cache[ownerKey];
  await writeState('favorites', cache);
}
