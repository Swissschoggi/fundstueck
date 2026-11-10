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
