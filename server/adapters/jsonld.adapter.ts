import type { NormalizedListing } from '../core/types.js';
import { SourceError } from '../core/types.js';
import type { MarketplaceAdapter, AdapterHealth, AdapterSearchParams } from '../core/types.js';
import { PoliteClient } from './scrape.js';
import { normalizeImages } from '../core/enrichment.js';

type JsonObject = Record<string, unknown>;

function obj(value: unknown): JsonObject | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function schemaCondition(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const tail = raw.split('/').filter(Boolean).pop()?.toLowerCase() ?? '';
  if (tail.includes('newcondition')) return 'New';
  if (tail.includes('usedcondition')) return 'Used';
  if (tail.includes('refurbished')) return 'Refurbished';
  if (tail.includes('damaged')) return 'For parts';
  return raw;
}

function schemaAvailability(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const tail = raw.split('/').filter(Boolean).pop() ?? '';
  switch (tail) {
    case 'InStock':
      return 'In stock';
    case 'OutOfStock':
      return 'Out of stock';
    case 'SoldOut':
      return 'Sold out';
    case 'PreOrder':
      return 'Pre-order';
    case 'BackOrder':
      return 'Back order';
    case 'LimitedAvailability':
      return 'Limited availability';
    default:
      return raw;
  }
}

function imageUrls(value: unknown): Array<string | null | undefined> {
  return list(value).flatMap((entry) => {
    if (typeof entry === 'string') return [entry];
    const o = obj(entry);
    return [text(o?.url) ?? text(o?.contentUrl)];
  });
}

export interface JsonLdAdapterOptions {
  id: string;
  label: string;
  markets: string[];
  currency: string;
  icon: string;
  description: string;
  docsUrl: string;
  envVar: string;
  enabled: boolean;
  capabilities: string[];
  acceptLanguage: string;
  userAgent: string;
  minIntervalMs: number;
  timeoutMs?: number;
  searchUrl: (q: string) => string;
  /** Optional: build a URL for a given page number (1-based). */
  searchPageUrl?: (q: string, page: number) => string;
}

export class JsonLdAdapter implements MarketplaceAdapter {
  readonly id: string;
  readonly label: string;
  readonly mode = 'live' as const;
  readonly markets: string[];
  readonly icon: string;
  readonly description: string;
  readonly auth = 'Public search page · JSON-LD';
  readonly envVars: string[];
  readonly capabilities: string[];
  readonly docsUrl: string;

  private readonly opts: JsonLdAdapterOptions;
  private readonly client: PoliteClient;

  constructor(opts: JsonLdAdapterOptions) {
    this.opts = opts;
    this.id = opts.id;
    this.label = opts.label;
    this.markets = [...opts.markets];
    this.icon = opts.icon;
    this.description = opts.description;
    this.envVars = [opts.envVar, 'SCRAPER_MIN_INTERVAL_MS', 'SCRAPER_USER_AGENT'];
    this.capabilities = [...opts.capabilities];
    this.docsUrl = opts.docsUrl;
    this.client = new PoliteClient({
      source: opts.label,
      userAgent: opts.userAgent,
      minIntervalMs: opts.minIntervalMs,
      timeoutMs: opts.timeoutMs ?? 6500,
      acceptLanguage: opts.acceptLanguage,
    });
  }

  isEnabled(): boolean {
    return this.opts.enabled;
  }

  disabledReason(): string | null {
    return this.opts.enabled ? null : `Disabled via ${this.opts.envVar}=false`;
  }

  private parse(html: string, fetchedAt: string): NormalizedListing[] {
    const out: NormalizedListing[] = [];
    const seen = new Set<string>();

    const emit = (item: JsonObject) => {
      const name = text(item['name']) ?? text(item['description']);
      const rawUrl = text(item['url']) ?? text(item['@id']);
      if (!name || !rawUrl) return;

      let listingUrl: string;
      try {
        listingUrl = rawUrl.startsWith('http')
          ? rawUrl
          : new URL(rawUrl, this.opts.docsUrl).toString();
      } catch {
        return;
      }
      if (seen.has(listingUrl)) return;
      seen.add(listingUrl);

      const offers = obj(item['offers']) ?? obj(list(item['offers'])[0]);
      const spec = obj(offers?.['priceSpecification']);
      const price =
        number(offers?.['price']) ?? number(spec?.['price']) ?? number(offers?.['lowPrice']);
      const currency =
        text(offers?.['priceCurrency']) ?? text(spec?.['priceCurrency']) ?? this.opts.currency;

      const sellerRaw = obj(offers?.['seller']) ?? obj(item['seller']);
      const sellerRating = obj(sellerRaw?.['aggregateRating']);
      const sellerName = text(sellerRaw?.['name']);
      const seller = sellerName
        ? {
            name: sellerName,
            type:
              sellerRaw?.['@type'] === 'Organization'
                ? ('business' as const)
                : ('private' as const),
            rating: number(sellerRating?.['ratingValue']),
            ratingScale: 'stars' as const,
            feedbackCount:
              number(sellerRating?.['reviewCount']) ?? number(sellerRating?.['ratingCount']),
          }
        : null;

      const brandRaw = item['brand'];
      const brand = text(obj(brandRaw)?.['name']) ?? text(brandRaw) ?? null;

      const absolute = (url: string | null | undefined): string | undefined => {
        if (!url) return undefined;
        try {
          return new URL(url, listingUrl).toString();
        } catch {
          return undefined;
        }
      };
      const images = normalizeImages(
        imageUrls(item['image']).map(absolute),
        imageUrls(item['thumbnailUrl']).map(absolute),
      );

      const attributes: Record<string, string> = {};
      if (brand) attributes.Brand = brand;
      const color = text(item['color']);
      if (color) attributes.Colour = color;
      const material = text(item['material']);
      if (material) attributes.Material = material;
      const model = text(item['model']);
      if (model) attributes.Model = model;
      const sku = text(item['sku']);
      if (sku) attributes.SKU = sku;
      const mpn = text(item['mpn']);
      if (mpn) attributes.MPN = mpn;
      const gtin =
        text(item['gtin13']) ??
        text(item['gtin12']) ??
        text(item['gtin8']) ??
        text(item['gtin']);
      if (gtin) attributes.GTIN = gtin;

      const shipRaw = offers?.['shippingDetails'];
      const ship = obj(shipRaw) ?? obj(list(shipRaw)[0]);
      const rate = obj(ship?.['shippingRate']);
      const shipValue = number(rate?.['value']) ?? number(rate?.['price']);
      const shipping =
        shipValue != null
          ? {
              cost: shipValue,
              currency:
                text(rate?.['currency']) ?? text(rate?.['priceCurrency']) ?? currency,
              free: shipValue === 0,
              label: shipValue === 0 ? 'Free shipping' : null,
            }
          : null;

      const publishedRaw = text(item['datePublished']) ?? text(offers?.['validFrom']);
      const publishedAt =
        publishedRaw && !Number.isNaN(Date.parse(publishedRaw)) ? publishedRaw : null;

      out.push({
        id: `${this.id}:${listingUrl}`,
        source: this.id,
        sourceListingId: listingUrl,
        title: name.trim(),
        description: text(item['description']) ?? '',
        price,
        currency,
        location: null,
        imageUrl: images[0] ?? null,
        images,
        listingUrl,
        publishedAt,
        fetchedAt,
        gender: null,
        condition: schemaCondition(offers?.['itemCondition'] ?? item['itemCondition']),
        category: text(item['category']) ?? null,
        brand,
        seller,
        shipping,
        attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
        availability: schemaAvailability(offers?.['availability']),
      });
    };

    const visit = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const n of node) visit(n);
        return;
      }
      const o = node as JsonObject;
      const type = o['@type'];
      const types = Array.isArray(type) ? type : [type];
      if (types.includes('ItemList')) {
        for (const el of list(o['itemListElement'])) {
          const item = obj(obj(el)?.['item']);
          if (item) emit(item);
        }
      }
      if (types.includes('Product')) emit(o);
      for (const v of Object.values(o)) {
        if (v && typeof v === 'object') visit(v);
      }
    };

    const scripts = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g) ?? [];
    for (const sc of scripts) {
      const inner = sc.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
      try {
        visit(JSON.parse(inner));
      } catch {
        /* ignore malformed blocks */
      }
    }
    return out;
  }

  async search({ q, limit, signal }: AdapterSearchParams): Promise<NormalizedListing[]> {
    if (!this.isEnabled()) {
      throw new SourceError(`${this.label} adapter is disabled`, 'AUTH');
    }
    const html = await this.client.getHtml(this.opts.searchUrl(q), { signal });
    return this.parse(html, new Date().toISOString()).slice(0, limit);
  }

  async searchPage({ q, limit, signal }: AdapterSearchParams, page: number): Promise<NormalizedListing[]> {
    if (!this.isEnabled()) {
      throw new SourceError(`${this.label} adapter is disabled`, 'AUTH');
    }
    const url = this.opts.searchPageUrl
      ? this.opts.searchPageUrl(q, page)
      : this.opts.searchUrl(q);
    const html = await this.client.getHtml(url, { signal });
    return this.parse(html, new Date().toISOString()).slice(0, limit);
  }

  async healthCheck(): Promise<AdapterHealth> {
    const started = Date.now();
    if (!this.isEnabled()) {
      return { ok: false, latencyMs: 0, message: this.disabledReason() ?? 'Disabled.' };
    }
    try {
      const html = await this.client.getHtml(this.opts.searchUrl('velo'), { fresh: true });
      const listings = this.parse(html, new Date().toISOString());
      const latencyMs = Date.now() - started;
      return listings.length > 0
        ? { ok: true, latencyMs, message: `Search page reachable — ${listings.length} listings parsed.` }
        : { ok: false, latencyMs, message: 'Search page reachable but contained no listings.' };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: err instanceof SourceError ? err.message : 'Health check failed.',
      };
    }
  }
}
