import type { Request, Response, Router } from 'express';
import type { ServerConfig } from '../config.js';
import { asRecord, str } from '../adapters/scrape.js';
import {
  changePassword,
  deleteAccount,
  getUserByToken,
  login,
  logout,
  parseCookies,
  register,
} from '../core/accounts.js';
import { listFavorites, addFavorite, removeFavorite, migrateFavorites, purgeFavorites } from '../core/favorites.js';
import { getUserPrefs, migratePrefs, purgePrefs, setSourceEnabledForOwner } from '../core/user-prefs.js';
import type { StoredFavorite } from '../core/favorites.js';
import { rateLimitMiddleware } from '../core/rate-limit.js';

const SESSION_COOKIE = 'fundstueck_session';
const SESSION_MAX_AGE_SEC = 30 * 24 * 3600;

function rawStr(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function setSessionCookie(res: Response, token: string, cfg: ServerConfig): void {
  const secure = cfg.nodeEnv === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SEC}${secure}`,
  );
}

function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function sessionToken(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE];
}

function currentUser(req: Request) {
  return getUserByToken(sessionToken(req));
}

/**
 * Who owns per-person data (saved items, source preferences) for this request:
 * the signed-in account, else the anonymous device id the client sent.
 */
export function ownerKeyFor(req: Request, device?: unknown): string | null {
  const user = currentUser(req);
  if (user) return `user:${user.id}`;
  const d = typeof device === 'string' ? device.trim() : '';
  return d || null;
}

/** Fold anonymous-device data into the account that just signed in. */
async function adoptDeviceData(userId: string, device: unknown): Promise<void> {
  const d = typeof device === 'string' ? device.trim() : '';
  if (!d) return;
  const toKey = `user:${userId}`;
  await migrateFavorites(d, toKey);
  await migratePrefs(d, toKey);
}

/**
 * Guards operator/admin routes (adapter install, custom sources, catalog
 * installs that execute commands, setup, config writes).
 *
 * Production: allow either a bearer OPERATOR_TOKEN or a signed-in session
 * whose email is listed in ADMIN_EMAILS. Anonymous internet traffic must
 * never reach the custom-source/command-execution endpoints.
 * Non-production: open, as before.
 */
export function operatorGuard(cfg: ServerConfig) {
  return (req: Request, res: Response, next: () => void): void => {
    if (cfg.nodeEnv !== 'production') {
      next();
      return;
    }
    const authz = req.headers.authorization ?? '';
    if (cfg.operatorToken && authz === `Bearer ${cfg.operatorToken}`) {
      next();
      return;
    }
    const user = currentUser(req);
    if (user && cfg.adminEmails.includes(user.email)) {
      next();
      return;
    }
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Operator authentication required.' },
    });
  };
}

export function mountAuthRoutes(router: Router, cfg: ServerConfig): void {
  // Brute-force protection on the auth surface: per-IP and per-email buckets.
  const loginIpLimiter = rateLimitMiddleware({ scope: 'login', limit: 10, windowMs: 5 * 60_000 });
  const loginEmailLimiter = rateLimitMiddleware({
    scope: 'login-email',
    limit: 10,
    windowMs: 5 * 60_000,
    by: (req) => String((req.body as { email?: unknown } | undefined)?.email ?? '').toLowerCase(),
  });
  const registerLimiter = rateLimitMiddleware({ scope: 'register', limit: 5, windowMs: 60 * 60_000 });

  router.post('/auth/register', registerLimiter, async (req, res) => {
    const body = asRecord(req.body) ?? {};
    const email = str(body.email);
    const password = rawStr(body.password);
    if (!email || !password) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'email and password are required.' } });
      return;
    }
    const result = await register(email, password);
    if ('error' in result) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: result.error } });
      return;
    }
    const loginResult = await login(email, password);
    if ('error' in loginResult) {
      res.status(500).json({ error: { code: 'INTERNAL', message: 'Account created but signing in failed. Please log in manually.' } });
      return;
    }
    setSessionCookie(res, loginResult.token, cfg);
    await adoptDeviceData(loginResult.user.id, body.device);
    res.json({ user: loginResult.user });
  });

  router.post('/auth/login', loginIpLimiter, loginEmailLimiter, async (req, res) => {
    const body = asRecord(req.body) ?? {};
    const email = str(body.email);
    const password = rawStr(body.password);
    if (!email || !password) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'email and password are required.' } });
      return;
    }
    const result = await login(email, password);
    if ('error' in result) {
      res.status(401).json({ error: { code: 'AUTH', message: result.error } });
      return;
    }
    setSessionCookie(res, result.token, cfg);
    await adoptDeviceData(result.user.id, body.device);
    res.json({ user: result.user });
  });

  router.post('/auth/logout', async (req, res) => {
    await logout(sessionToken(req));
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  router.get('/auth/me', (req, res) => {
    res.json({ user: currentUser(req) });
  });

  router.post('/auth/password', async (req, res) => {
    const user = currentUser(req);
    if (!user) {
      res.status(401).json({ error: { code: 'AUTH', message: 'Sign in required.' } });
      return;
    }
    const body = asRecord(req.body) ?? {};
    const currentPassword = rawStr(body.currentPassword);
    const newPassword = rawStr(body.newPassword);
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'currentPassword and newPassword are required.' } });
      return;
    }
    const result = await changePassword(user.id, currentPassword, newPassword, sessionToken(req));
    if ('error' in result) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: result.error } });
      return;
    }
    res.json({ ok: true });
  });

  router.delete('/auth/account', async (req, res) => {
    const user = currentUser(req);
    if (!user) {
      res.status(401).json({ error: { code: 'AUTH', message: 'Sign in required.' } });
      return;
    }
    const body = asRecord(req.body) ?? {};
    const password = rawStr(body.password);
    if (!password) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'password is required to delete the account.' } });
      return;
    }
    const result = await deleteAccount(user.id, password);
    if ('error' in result) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: result.error } });
      return;
    }
    await purgeFavorites(`user:${user.id}`);
    await purgePrefs(`user:${user.id}`);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // ---- Per-account source preferences (device-scoped when signed out) ----

  router.get('/preferences', (req, res) => {
    const key = ownerKeyFor(req, req.query.device);
    res.json({ preferences: getUserPrefs(key), scope: key?.startsWith('user:') ? 'account' : 'device' });
  });

  router.post('/preferences/sources/:id', async (req, res) => {
    const body = asRecord(req.body) ?? {};
    const key = ownerKeyFor(req, body.device);
    if (!key) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: '\"device\" is required when signed out.' } });
      return;
    }
    if (typeof body.enabled !== 'boolean') {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Body must include { \"enabled\": boolean }.' } });
      return;
    }
    const preferences = await setSourceEnabledForOwner(key, req.params.id, body.enabled);
    res.json({ preferences });
  });

  // ---- Favorites (per-user when signed in, per-device otherwise) ----

  router.get('/favorites', (req, res) => {
    const user = currentUser(req);
    const device = typeof req.query.device === 'string' ? req.query.device.trim() : '';
    const key = user ? `user:${user.id}` : device;
    if (!key) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: '"device" query param is required.' } });
      return;
    }
    res.json({ favorites: listFavorites(key) });
  });

  router.post('/favorites', async (req, res) => {
    const body = asRecord(req.body) ?? {};
    const user = currentUser(req);
    const device = str(body.device);
    const key = user ? `user:${user.id}` : device;
    const listing = asRecord(body.listing);
    if (!key || !listing) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Body must include device and listing.' } });
      return;
    }
    const fav: StoredFavorite = {
      id: str(listing.id) ?? '',
      source: str(listing.source) ?? '',
      title: str(listing.title) ?? '',
      price: typeof listing.price === 'number' ? listing.price : null,
      currency: str(listing.currency) ?? 'CHF',
      listingUrl: str(listing.listingUrl) ?? '',
      imageUrl: str(listing.imageUrl) ?? null,
      savedAt: new Date().toISOString(),
    };
    if (!fav.id || !fav.listingUrl) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Listing is missing id or listingUrl.' } });
      return;
    }
    await addFavorite(key, fav);
    res.json({ ok: true });
  });

  router.delete('/favorites', async (req, res) => {
    const body = asRecord(req.body) ?? {};
    const user = currentUser(req);
    const device = str(body.device) ?? (typeof req.query.device === 'string' ? req.query.device : '');
    const key = user ? `user:${user.id}` : device;
    const listingId = str(body.listingId) ?? (typeof req.query.listingId === 'string' ? req.query.listingId : '');
    if (!key || !listingId) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'device and listingId are required.' } });
      return;
    }
    await removeFavorite(key, listingId);
    res.json({ ok: true });
  });
}
