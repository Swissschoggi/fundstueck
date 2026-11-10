import crypto from 'node:crypto';
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

export async function initAccounts(_cfg: ServerConfig): Promise<void> {
  const parsed = await readState<AccountStore>('accounts');
  store = parsed && Array.isArray(parsed.users) ? { users: parsed.users, sessions: parsed.sessions ?? [] } : { users: [], sessions: [] };
}

function persist(): void {
  void writeState('accounts', store);
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const computed = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(computed, 'hex'));
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function register(email: string, password: string): { user: Omit<AccountUser, 'passwordHash'> } | { error: string } {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !password || password.length < 6) {
    return { error: 'Email and password (min 6 chars) are required.' };
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
  persist();
  return { user: { id: user.id, email: user.email, createdAt: user.createdAt } };
}

export function login(email: string, password: string): { user: Omit<AccountUser, 'passwordHash'>; token: string } | { error: string } {
  const normalized = email.trim().toLowerCase();
  const user = store.users.find((u) => u.email === normalized);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return { error: 'Invalid email or password.' };
  }
  const token = crypto.randomBytes(32).toString('hex');
  const session: AccountSession = {
    tokenHash: hashToken(token),
    userId: user.id,
    expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
  };
  store.sessions = store.sessions.filter((s) => s.userId !== user.id || new Date(s.expiresAt) > new Date());
  store.sessions.push(session);
  persist();
  return { user: { id: user.id, email: user.email, createdAt: user.createdAt }, token };
}

export function logout(token: string | undefined): void {
  if (!token) return;
  const h = hashToken(token);
  store.sessions = store.sessions.filter((s) => s.tokenHash !== h);
  persist();
}

export function getUserByToken(token: string | undefined): Omit<AccountUser, 'passwordHash'> | null {
  if (!token) return null;
  const h = hashToken(token);
  const session = store.sessions.find((s) => s.tokenHash === h);
  if (!session) return null;
  if (new Date(session.expiresAt) <= new Date()) {
    store.sessions = store.sessions.filter((s) => s.tokenHash !== h);
    persist();
    return null;
  }
  const user = store.users.find((u) => u.id === session.userId);
  if (!user) return null;
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (!k) continue;
    out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}
