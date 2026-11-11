import type { ServerConfig } from '../config.js';
import { readState, writeState } from './storage.js';

/**
 * Per-owner search preferences. An "owner key" is `user:<id>` for a signed-in
 * account or the anonymous device id otherwise (same scheme as favorites).
 *
 * The operator's global enable/disable switch (adapter settings) stays the
 * master switch: a user can only turn OFF sources the operator has enabled,
 * never turn on something the operator disabled.
 */
export interface UserPrefs {
  /** Source ids this owner switched off for their own searches. */
  disabledSources: string[];
  updatedAt: string;
}

interface PrefsStore {
  [ownerKey: string]: UserPrefs;
}

let cache: PrefsStore = {};

export async function initUserPrefs(_cfg: ServerConfig): Promise<void> {
  const parsed = await readState<PrefsStore>('user-prefs');
  cache = parsed && typeof parsed === 'object' ? parsed : {};
}

async function persist(): Promise<void> {
  await writeState('user-prefs', cache);
}

export function getUserPrefs(ownerKey: string | null | undefined): UserPrefs {
  const found = ownerKey ? cache[ownerKey] : undefined;
  return { disabledSources: [...(found?.disabledSources ?? [])], updatedAt: found?.updatedAt ?? '' };
}

export async function setSourceEnabledForOwner(
  ownerKey: string,
  sourceId: string,
  enabled: boolean,
): Promise<UserPrefs> {
  const current = new Set(cache[ownerKey]?.disabledSources ?? []);
  if (enabled) current.delete(sourceId);
  else current.add(sourceId);
  cache[ownerKey] = { disabledSources: [...current], updatedAt: new Date().toISOString() };
  await persist();
  return getUserPrefs(ownerKey);
}

/**
 * Move an anonymous device's preferences into an account on sign-in.
 * The account's own choices win; the device's are only adopted when the
 * account has none yet. The device bucket is cleared afterwards.
 */
export async function migratePrefs(fromKey: string, toKey: string): Promise<void> {
  if (!fromKey || fromKey === toKey || !cache[fromKey]) return;
  if (!cache[toKey]) cache[toKey] = { ...cache[fromKey], updatedAt: new Date().toISOString() };
  delete cache[fromKey];
  await persist();
}

/** Remove an owner's preferences (used when an account is deleted). */
export async function purgePrefs(ownerKey: string): Promise<void> {
  if (!cache[ownerKey]) return;
  delete cache[ownerKey];
  await persist();
}
