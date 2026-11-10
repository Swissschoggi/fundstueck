import type { ServerConfig } from '../config.js';
import { findMarket, marketForEbayMarketplace, MARKETS } from '../core/markets.js';
import type {
  AdapterHealth,
  AdapterSearchParams,
  MarketplaceAdapter,
  NormalizedListing,
} from '../core/types.js';
import { SourceError } from '../core/types.js';
import { getAdapterConfig } from '../core/adapter-config.js';

/** Request time budget for every outbound eBay call. */
const TIMEOUT_MS = 8_000;

/** Minimal subset of the eBay Browse API payloads we consume. */
interface EbayTokenResponse {
  access_token: string;
  expires_in: number;
}

interface EbayAmount {
  value: string;
  currency: string;
}

interface EbayItemSummary {
  itemId: string;
  title: string;
  price?: EbayAmount;
  condition?: string;
  conditionId?: string;
  shortDescription?: string;
  image?: { imageUrl?: string };
  itemWebUrl: string;
  itemLocation?: {
    city?: string;
    postalCode?: string;
    country?: string;
  };
  itemOriginDate?: string;
  shippingOptions?: Array<{ shippingCost?: EbayAmount }>;
  categories?: Array<{ categoryName?: string }>;
}

interface EbaySearchResponse {
  itemSummaries?: EbayItemSummary[];
  total?: number;
}

const CONDITION_LABELS: Record<string, string> = {
  NEW: 'New',
  NEW_OTHER: 'New other',
  MANUFACTURER_REFURBISHED: 'Refurbished',
  SELLER_REFURBISHED: 'Seller refurbished',
  USED_EXCELLENT: 'Used · excellent',
  USED_VERY_GOOD: 'Used · very good',
  USED_GOOD: 'Used · good',
  USED_ACCEPTABLE: 'Used · acceptable',
  LIKE_NEW: 'Like new',
  CERTIFIED_REFURBISHED: 'Certified refurbished',
  FOR_PARTS_OR_NOT_WORKING: 'For parts',
  UNspecified: 'Unspecified',
};

/**
 * eBay Buy Browse API adapter — the official, permitted access path.
 * Docs: https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search
 * Auth: client-credentials grant (application token, public data only).
 * Requires EBAY_CLIENT_ID / EBAY_CLIENT_SECRET (see .env.example).
 */
export class EbayAdapter implements MarketplaceAdapter {
  readonly id = 'ebay';
  readonly mode = 'live' as const;
  readonly label = 'eBay';
  get markets(): string[] {
    return MARKETS.map((m) => m.code);
  }
  readonly icon = 'shopping_bag';
  readonly auth = 'Official Browse API · OAuth2';
  readonly envVars = ['EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET', 'EBAY_MARKETPLACE_ID'];
  get capabilities(): string[] {
    return [
      'Official public API',
      `Fallback marketplace: ${this.ebayCfg().marketplaceId}`,
      'Market per search',
      'Fixed-price listings',
      'Condition labels',
      'Location metadata',
    ];
  }
  readonly docsUrl =
    'https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search';
  readonly description =
    'Official eBay Browse API (application token, public listings only). The eBay ' +
    'marketplace follows the buyer market chosen for each search; EBAY_MARKETPLACE_ID ' +
    'is only the fallback context.';

  readonly configFields = [
    {
      key: 'client_id',
      label: 'eBay Client ID (App ID)',
      secret: true,
      placeholder: 'paste your eBay App ID',
      help: 'From developer.ebay.com → My Account → Application Keys. Stored in data/adapter-config.json.',
    },
    {
      key: 'client_secret',
      label: 'eBay Client Secret (Cert ID)',
      secret: true,
      placeholder: 'paste your eBay Cert ID',
      help: 'Stored securely. Takes precedence over EBAY_CLIENT_SECRET env var.',
    },
    {
      key: 'marketplace_id',
      label: 'Fallback marketplace ID',
      placeholder: 'EBAY_CH',
      help: 'eBay marketplace used when no buyer market is specified (e.g. EBAY_CH, EBAY_DE, EBAY_US).',
    },
  ];

  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly cfg: ServerConfig['ebay']) {}

  private ebayCfg() {
    const stored = getAdapterConfig(this.id);
    return {
      clientId: (stored.client_id || this.cfg.clientId || '').trim() || undefined,
      clientSecret: (stored.client_secret || this.cfg.clientSecret || '').trim() || undefined,
      marketplaceId: (stored.marketplace_id || this.cfg.marketplaceId || 'EBAY_CH').trim(),
      apiBase: this.cfg.apiBase,
    };
  }

  isEnabled(): boolean {
    const c = this.ebayCfg();
    return Boolean(c.clientId && c.clientSecret);
  }

  disabledReason(): string | null {
    return this.isEnabled()
      ? null
      : 'Not configured — set Client ID & Secret via Config, or EBAY_CLIENT_ID/EBAY_CLIENT_SECRET env vars.';
  }

  async healthCheck(): Promise<AdapterHealth> {
    const started = Date.now();
    if (!this.isEnabled()) {
      return { ok: false, latencyMs: 0, message: 'Not configured — missing eBay credentials.' };
    }
    try {
      // Force a fresh token so the probe actually validates the credentials.
      this.token = null;
      await this.getToken();
      return {
        ok: true,
        latencyMs: Date.now() - started,
        message: `OAuth token issued for marketplace ${this.ebayCfg().marketplaceId}.`,
      };
    } catch (err) {
      const message = err instanceof SourceError ? err.message : 'Health check failed.';
      return { ok: false, latencyMs: Date.now() - started, message };
    }
  }

  async search(params: AdapterSearchParams): Promise<NormalizedListing[]> {
    const market =
      findMarket(params.market ?? '') ??
      marketForEbayMarketplace(this.ebayCfg().marketplaceId) ??
      findMarket('CH')!;
    const marketplaceId = market.ebayMarketplaceId;
    const token = await this.getToken();
    const url = new URL(`${this.ebayCfg().apiBase}/buy/browse/v1/item_summary/search`);
    url.searchParams.set('q', params.q);
    url.searchParams.set('limit', String(params.limit));

    const marketCurrency = market.currency;
    const filters: string[] = [];
    if (params.minPrice != null || params.maxPrice != null) {
      const min = params.minPrice != null ? params.minPrice : '';
      const max = params.maxPrice != null ? params.maxPrice : '';
      filters.push(`price:[${min}..${max}]`);
      filters.push(`priceCurrency:${marketCurrency}`);
    }
    if (filters.length) url.searchParams.set('filter', filters.join(','));

    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
          'X-EBAY-C-ENDUSERCTX': `contextualLocation=country=${market.code}`,
          'Accept-Language': market.locale,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new SourceError(`eBay request failed: ${(err as Error).message}`, 'NETWORK');
    }

    if (!res.ok) {
      // Invalidate cached token on auth errors so the next search retries fresh.
      if (res.status === 401 || res.status === 403) this.token = null;
      throw new SourceError(
        `eBay responded with HTTP ${res.status} (marketplace ${marketplaceId})`,
        'UPSTREAM',
        res.status,
      );
    }

    let data: EbaySearchResponse;
    try {
      data = (await res.json()) as EbaySearchResponse;
    } catch {
      throw new SourceError('eBay returned an invalid JSON payload', 'RESPONSE');
    }

    const fetchedAt = new Date().toISOString();
    return (data.itemSummaries ?? []).map((item) =>
      this.normalize(item, fetchedAt, market.currency),
    );
  }

  private normalize(
    item: EbayItemSummary,
    fetchedAt: string,
    fallbackCurrency: string,
  ): NormalizedListing {
    const location = [item.itemLocation?.city, item.itemLocation?.postalCode]
      .filter(Boolean)
      .join(' ');

    const price = item.price?.value != null ? Number(item.price.value) : null;
    const condition =
      (item.condition && CONDITION_LABELS[item.condition]) || item.condition || null;
    const shipping =
      item.shippingOptions?.[0]?.shippingCost != null
        ? Number(item.shippingOptions[0].shippingCost.value) === 0
          ? 'Free shipping'
          : `Shipping ${item.shippingOptions[0].shippingCost.value} ${item.price?.currency ?? ''}`
        : null;

    return {
      id: `${this.id}:${item.itemId}`,
      source: this.id,
      sourceListingId: item.itemId,
      title: item.title,
      description:
        item.shortDescription?.trim() ||
        [condition, item.categories?.[0]?.categoryName, shipping]
          .filter(Boolean)
          .join(' · '),
      price: Number.isFinite(price) ? price : null,
      currency: item.price?.currency ?? fallbackCurrency,
      location: location || null,
      imageUrl: item.image?.imageUrl ?? null,
      listingUrl: item.itemWebUrl,
      publishedAt: item.itemOriginDate ?? null,
      fetchedAt,
    };
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) {
      return this.token.value;
    }

    const c = this.ebayCfg();
    const clientId = c.clientId;
    const clientSecret = c.clientSecret;
    if (!clientId || !clientSecret) {
      throw new SourceError('eBay adapter is not configured', 'AUTH');
    }

    let res: Response;
    try {
      res = await fetch(`${this.ebayCfg().apiBase}/identity/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new SourceError(`eBay auth request failed: ${(err as Error).message}`, 'NETWORK');
    }

    if (!res.ok) {
      throw new SourceError(
        `eBay auth failed with HTTP ${res.status} — check EBAY_CLIENT_ID / EBAY_CLIENT_SECRET`,
        'AUTH',
        res.status,
      );
    }

    const data = (await res.json()) as EbayTokenResponse;
    this.token = {
      value: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return this.token.value;
  }
}
