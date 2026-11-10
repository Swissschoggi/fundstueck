import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, before, after } from 'node:test';
import { initStorage, closeStorage } from './storage.js';
import {
  changePassword,
  deleteAccount,
  getUserByToken,
  initAccounts,
  login,
  logout,
  parseCookies,
  register,
} from './accounts.js';

const dataDir = mkdtempSync(path.join(tmpdir(), 'fundstueck-accounts-'));

before(async () => {
  await initStorage({
    dataDir,
    databaseUrl: undefined,
  } as never);
  await initAccounts({} as never);
});

after(async () => {
  await closeStorage();
  rmSync(dataDir, { recursive: true, force: true });
});

test('register rejects invalid email and weak password', async () => {
  assert('error' in (await register('not-an-email', 'password123')));
  assert('error' in (await register('a@b.ch', 'short')));
  assert('error' in (await register('a@b.ch', 'x'.repeat(73))));
  assert('error' in (await register('', 'password123')));
});

test('register, login, me, logout lifecycle', async () => {
  const reg = await register('User@Example.ch', 'password123');
  assert('user' in reg);
  assert.equal(reg.user.email, 'user@example.ch'); // normalized

  const dup = await register('user@example.ch', 'password123');
  assert('error' in dup);

  const bad = await login('user@example.ch', 'wrong-password');
  assert('error' in bad);

  const ok = await login('user@example.ch', 'password123');
  assert('token' in ok);
  assert.equal(getUserByToken(ok.token)?.email, 'user@example.ch');

  // Unknown email takes the same code path (timing-safe) and fails cleanly.
  const unknown = await login('nobody@example.ch', 'password123');
  assert('error' in unknown);

  await logout(ok.token);
  assert.equal(getUserByToken(ok.token), null);
});

test('multiple concurrent sessions survive login on another device', async () => {
  await register('multi@example.ch', 'password123');
  const a = await login('multi@example.ch', 'password123');
  const b = await login('multi@example.ch', 'password123');
  assert('token' in a && 'token' in b);
  assert.ok(getUserByToken(a.token));
  assert.ok(getUserByToken(b.token));
});

test('changePassword revokes other sessions and keeps the current one', async () => {
  await register('pw@example.ch', 'password123');
  const first = await login('pw@example.ch', 'password123');
  const second = await login('pw@example.ch', 'password123');
  assert('token' in first && 'token' in second);

  const user = getUserByToken(first.token);
  assert.ok(user);
  const changed = await changePassword(user.id, 'password123', 'newpassword1', first.token);
  assert('ok' in changed);

  assert.ok(getUserByToken(first.token), 'current session survives');
  assert.equal(getUserByToken(second.token), null, 'other sessions revoked');
  assert('error' in (await login('pw@example.ch', 'password123')));
  assert('token' in (await login('pw@example.ch', 'newpassword1')));
});

test('deleteAccount removes user and sessions', async () => {
  await register('del@example.ch', 'password123');
  const session = await login('del@example.ch', 'password123');
  assert('token' in session);
  const user = getUserByToken(session.token);
  assert.ok(user);

  assert('error' in (await deleteAccount(user.id, 'wrong-password')));
  assert('ok' in (await deleteAccount(user.id, 'password123')));
  assert.equal(getUserByToken(session.token), null);
  assert('error' in (await login('del@example.ch', 'password123')));
});

test('parseCookies tolerates malformed values', () => {
  assert.deepEqual(parseCookies('a=1; bad=%E0%A4%A; fundstueck_session=abc'), {
    a: '1',
    fundstueck_session: 'abc',
  });
  assert.deepEqual(parseCookies(undefined), {});
});
