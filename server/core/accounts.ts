import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { ServerConfig } from '../config.js';
import { readState, writeState } from './storage.js';

export interface AccountUser {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface AccountSession {
  tokenHash: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
}

interface AccountStore {
  users: AccountUser[];
  sessions: AccountSession[];
}

let store: AccountStore = { users: [], sessions: [] };

// Pre-computed at boot so a login attempt for an unknown email still pays the
// same scrypt cost as a real one — closes the timing side-channel that leaks
// which email addresses are registered.
const DUMMY_PASSWORD_HASH = (() => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync('dummy-password', salt, 64).toString('hex');
  return `${salt}:${hash}`;
})();

const scryptAsync = promisify(crypto.scrypt);

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72; // also protects the scrypt cost from being abused as a DoS amplifier
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const MAX_SESSIONS_PER_USER = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function initAccounts(_cfg: ServerConfig): Promise<void> {
  const parsed = await readState<AccountStore>('accounts');
  const users = parsed && Array.isArray(parsed.users) ? parsed.users : [];
  const sessions =
    parsed && Array.isArray(parsed.sessions)
      ? parsed.sessions.filter((s) => new Date(s.expiresAt) > new Date())
      : [];
  store = { users, sessions };
  await persist();
}

// Every state mutation goes through here and is awaited. The previous
// fire-and-forget version could lose accounts on crash and turned a failed
// write into an unhandled promise rejection (fatal on modern Node).
async function persist(): Promise<void> {
  try {
    await writeState('accounts', store);
  } catch (err) {
    console.error('[accounts] failed to persist account store:', err);
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const computed = (await scryptAsync(password, salt, 64) as Buffer).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(computed, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function publicUser(user: AccountUser): Omit<AccountUser, 'passwordHash'> {
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}

function createSession(userId: string): { token: string; session: AccountSession } {
  const token = crypto.randomBytes(32).toString('hex');
  const session: AccountSession = {
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    createdAt: new Date().toISOString(),
  };
  // Allow multiple concurrent sessions (phone + laptop) but bound them.
  const mine = store.sessions
    .filter((s) => s.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const drop = new Set(mine.slice(MAX_SESSIONS_PER_USER - 1).map((s) => s.tokenHash));
  store.sessions = store.sessions.filter((s) => !drop.has(s.tokenHash));
  store.sessions.push(session);
  return { token, session };
}

export async function register(
  email: string,
  password: string,
): Promise<{ user: Omit<AccountUser, 'passwordHash'> } | { error: string }> {
  const normalized = normalizeEmail(email);
  if (!normalized || normalized.length > 254 || !EMAIL_RE.test(normalized)) {
    return { error: 'A valid email address is required.' };
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { error: `Password must be at most ${MAX_PASSWORD_LENGTH} characters.` };
  }
  if (store.users.some((u) => u.email === normalized)) {
    return { error: 'An account with this email already exists.' };
  }
  const user: AccountUser = {
    id: crypto.randomUUID(),
    email: normalized,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  store.users.push(user);
  await persist();
  return { user: publicUser(user) };
}

export async function login(
  email: string,
  password: string,
): Promise<{ user: Omit<AccountUser, 'passwordHash'>; token: string } | { error: string }> {
  const normalized = normalizeEmail(email);
  if (!normalized || !password || password.length > MAX_PASSWORD_LENGTH) {
    return { error: 'Invalid email or password.' };
  }
  const user = store.users.find((u) => u.email === normalized);
  // Always run the hash — even for unknown emails — so response time does not
  // reveal whether the account exists.
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !ok) {
    return { error: 'Invalid email or password.' };
  }
  // Opportunistic cleanup of expired sessions.
  store.sessions = store.sessions.filter((s) => new Date(s.expiresAt) > new Date());
  const { token } = createSession(user.id);
  await persist();
  return { user: publicUser(user), token };
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  const h = hashToken(token);
  if (!store.sessions.some((s) => s.tokenHash === h)) return;
  store.sessions = store.sessions.filter((s) => s.tokenHash !== h);
  await persist();
}

export function getUserByToken(token: string | undefined): Omit<AccountUser, 'passwordHash'> | null {
  if (!token) return null;
  const h = hashToken(token);
  const session = store.sessions.find((s) => s.tokenHash === h);
  if (!session) return null;
  if (new Date(session.expiresAt) <= new Date()) {
    store.sessions = store.sessions.filter((s) => s.tokenHash !== h);
    void persist();
    return null;
  }
  const user = store.users.find((u) => u.id === session.userId);
  if (!user) return null;
  return publicUser(user);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepToken: string | undefined,
): Promise<{ ok: true } | { error: string }> {
  const user = store.users.find((u) => u.id === userId);
  if (!user) return { error: 'Account not found.' };
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    return { error: 'Current password is incorrect.' };
  }
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (newPassword.length > MAX_PASSWORD_LENGTH) {
    return { error: `Password must be at most ${MAX_PASSWORD_LENGTH} characters.` };
  }
  user.passwordHash = hashPassword(newPassword);
  // Revoke every other session on password change; the current device stays
  // signed in if its token is supplied.
  const keep = keepToken ? hashToken(keepToken) : null;
  store.sessions = store.sessions.filter(
    (s) => s.userId !== userId || s.tokenHash === keep,
  );
  await persist();
  return { ok: true };
}

export async function deleteAccount(
  userId: string,
  password: string,
): Promise<{ ok: true } | { error: string }> {
  const user = store.users.find((u) => u.id === userId);
  if (!user) return { error: 'Account not found.' };
  if (!(await verifyPassword(password, user.passwordHash))) {
    return { error: 'Password is incorrect.' };
  }
  store.users = store.users.filter((u) => u.id !== userId);
  store.sessions = store.sessions.filter((s) => s.userId !== userId);
  await persist();
  return { ok: true };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v.join('='));
    } catch {
      // Ignore malformed cookie values instead of crashing every authed route.
    }
  }
  return out;
}
