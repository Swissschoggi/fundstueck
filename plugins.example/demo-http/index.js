/**
 * Minimal Fundstück source plugin.
 *
 * Contract:
 *   export function createAdapters(ctx) -> adapter | adapter[]
 *   - ctx.env            process.env
 *   - ctx.userAgent      configured scraper user agent
 *   - ctx.minIntervalMs  configured politeness interval
 *   - ctx.dataDir        writable data directory
 *
 * An adapter must implement the MarketplaceAdapter shape:
 *   id, label, mode ('live'|'sample'), description, auth, envVars,
 *   capabilities, icon, markets, isEnabled(), disabledReason(),
 *   healthCheck() -> { ok, latencyMs, message }, search({ q, limit }) -> listings.
 * Listings use the shared NormalizedListing fields.
 */

const API = 'https://dummyjson.com/products/search';
const CURRENCY = 'CHF';

export function createAdapters() {
  return {
    id: 'demo-http',
    label: 'Demo JSON products',
    mode: 'live',
    description: 'Public demo catalog mapped by a local plugin.',
    auth: 'Public JSON API',
    envVars: [],
    capabilities: ['Plugin', 'HTTP JSON'],
    icon: 'science',
    markets: ['CH'],

    isEnabled() {
      return true;
    },

    disabledReason() {
      return null;
    },

    async healthCheck() {
      const started = Date.now();
      try {
        const listings = await this.search({ q: 'phone', limit: 1 });
        return {
          ok: true,
          latencyMs: Date.now() - started,
          message: `Reachable (${listings.length} sample result).`,
        };
      } catch (err) {
        return {
          ok: false,
          latencyMs: Date.now() - started,
          message: err.message ?? 'Health check failed.',
        };
      }
    },

    async search({ q, limit }) {
      const url = new URL(API);
      url.searchParams.set('q', q);
      url.searchParams.set('limit', String(Math.max(1, Math.min(limit, 50))));
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`Demo API returned HTTP ${res.status}.`);
      const body = await res.json();
      const products = Array.isArray(body.products) ? body.products : [];
      const fetchedAt = new Date().toISOString();
      return products.map((p) => ({
        id: `demo-http:${p.id}`,
        source: 'demo-http',
        sourceListingId: String(p.id),
        title: String(p.title ?? 'Untitled'),
        description: String(p.description ?? ''),
        price: typeof p.price === 'number' ? p.price : null,
        currency: CURRENCY,
        location: null,
        imageUrl: p.thumbnail ?? null,
        listingUrl: `https://dummyjson.com/products/${p.id}`,
        publishedAt: null,
        fetchedAt,
      }));
    },
  };
}
