import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { initStorage } from './storage.js';
import { addFavorite, initFavorites, listFavorites, migrateFavorites, type StoredFavorite } from './favorites.js';
import { getUserPrefs, initUserPrefs, migratePrefs, setSourceEnabledForOwner } from './user-prefs.js';

const fav = (id: string, savedAt: string): StoredFavorite => ({
  id, source: 's', title: id, price: 1, currency: 'CHF', listingUrl: `https://x.test/${id}`, imageUrl: null, savedAt,
});

describe('per-account data', () => {
  before(async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fundstueck-test-'));
    const cfg = loadConfig({ DATA_DIR: dataDir } as NodeJS.ProcessEnv);
    await initStorage(cfg);
    await initFavorites(cfg);
    await initUserPrefs(cfg);
  });

  it('merges device favorites into the account without duplicates and clears the device', async () => {
    await addFavorite('device-1', fav('a', '2026-01-01T00:00:00Z'));
    await addFavorite('device-1', fav('b', '2026-01-02T00:00:00Z'));
    await addFavorite('user:u1', fav('b', '2026-01-03T00:00:00Z'));
    await addFavorite('user:u1', fav('c', '2026-01-04T00:00:00Z'));

    const moved = await migrateFavorites('device-1', 'user:u1');
    assert.equal(moved, 2);
    const ids = listFavorites('user:u1').map((f) => f.id).sort();
    assert.deepEqual(ids, ['a', 'b', 'c']);
    assert.equal(listFavorites('device-1').length, 0);
    // Running it again is a no-op.
    assert.equal(await migrateFavorites('device-1', 'user:u1'), 0);
  });

  it('keeps source preferences separate per owner', async () => {
    await setSourceEnabledForOwner('user:u1', 'tutti', false);
    assert.deepEqual(getUserPrefs('user:u1').disabledSources, ['tutti']);
    assert.deepEqual(getUserPrefs('user:u2').disabledSources, []);
    await setSourceEnabledForOwner('user:u1', 'tutti', true);
    assert.deepEqual(getUserPrefs('user:u1').disabledSources, []);
  });

  it('adopts device preferences on sign-in only when the account has none', async () => {
    await setSourceEnabledForOwner('device-2', 'marko', false);
    await migratePrefs('device-2', 'user:u3');
    assert.deepEqual(getUserPrefs('user:u3').disabledSources, ['marko']);
    assert.deepEqual(getUserPrefs('device-2').disabledSources, []);

    await setSourceEnabledForOwner('device-3', 'anibis', false);
    await migratePrefs('device-3', 'user:u3'); // account already has choices
    assert.deepEqual(getUserPrefs('user:u3').disabledSources, ['marko']);
  });
});
