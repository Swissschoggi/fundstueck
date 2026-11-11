/* Fundstück service worker.
 *
 * Goals: installable app shell that opens instantly and survives a flaky
 * connection, WITHOUT ever serving stale search results or account data.
 *
 *  - /api/*           → never touched (always live network)
 *  - navigations      → network first, fall back to the cached shell offline
 *  - /assets/* (hashed) → cache first (immutable)
 *  - Google Fonts     → stale-while-revalidate
 *
 * Bump VERSION to invalidate every cache.
 */
const VERSION = 'v1';
const SHELL_CACHE = `fundstueck-shell-${VERSION}`;
const ASSET_CACHE = `fundstueck-assets-${VERSION}`;
const FONT_CACHE = `fundstueck-fonts-${VERSION}`;
const KEEP = new Set([SHELL_CACHE, ASSET_CACHE, FONT_CACHE]);

const SHELL_URLS = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Fonts (cross-origin, safe to cache).
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Live data: never cache, never intercept.
  if (url.pathname.startsWith('/api/')) return;

  // Page loads: fresh when online, cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || Response.error())),
    );
    return;
  }

  // Hashed build output never changes for a given URL.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  // Icons, manifest and other small static files.
  event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || network;
}
