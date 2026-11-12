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
import { combineSignals } from './scrape.js';
import { normalizeImages } from '../core/enrichment.js';

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

interface EbayImage {
  imageUrl?: string;
}

interface EbaySeller {
  username?: string;
  feedbackPercentage?: string;
  feedbackScore?: number;
  sellerAccountType?: string;
}

interface EbayShippingOption {
  shippingCost?: EbayAmount;
  shippingCostType?: string;
  minEstimatedDeliveryDate?: string;
  maxEstimatedDeliveryDate?: string;
}

interface EbayAspect {
  name?: string;
  value?: string;
}

interface EbayItemSummary {
  itemId: string;
  title: string;
  price?: EbayAmount;
  currentBidPrice?: EbayAmount;
  condition?: string;
  conditionId?: string;
  shortDescription?: string;
  image?: EbayImage;
  additionalImages?: EbayImage[];
  thumbnailImages?: EbayImage[];
  itemWebUrl: string;
  itemLocation?: {
    city?: string;
    postalCode?: string;
    country?: string;
  };
  itemOriginDate?: string;
  itemCreationDate?: string;
  itemEndDate?: string;
  seller?: EbaySeller;
  buyingOptions?: string[];
  bidCount?: number;
  shippingOptions?: EbayShippingOption[];
  categories?: Array<{ categoryName?: string }>;
  categoryPath?: string;
  localizedAspects?: EbayAspect[];
  marketingPrice?: {
    originalPrice?: EbayAmount;
    discountPercentage?: string;
    discountAmount?: EbayAmount;
  };
}

interface EbaySearchResponse {
  itemSummaries?: EbayItemSummary[];
  total?: number;
}

const BUYING_OPTION_LABELS: Record<string, string> = {
  FIXED_PRICE: 'Buy it now',
  AUCTION: 'Auction',
  BEST_OFFER: 'Best offer',
  CLASSIFIED_AD: 'Classified ad',
};

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

/** Convert one Browse API item summary into the shared listing model. */
export function normalizeEbayItem(
  item: EbayItemSummary,
  fetchedAt: string,
  fallbackCurrency: string,
): NormalizedListing {
  const location = [
    item.itemLocation?.city,
    item.itemLocation?.postalCode,
    item.itemLocation?.country,
  ]
    .filter(Boolean)
    .join(', ');

  const priceAmount = item.price ?? item.currentBidPrice;
  const price = priceAmount?.value != null ? Number(priceAmount.value) : null;
  const currency = priceAmount?.currency ?? fallbackCurrency;

  const condition =
    (item.condition && CONDITION_LABELS[item.condition]) || item.condition || null;

  const images = normalizeImages(
    item.image?.imageUrl,
    (item.additionalImages ?? []).map((img) => img.imageUrl),
    (item.thumbnailImages ?? []).map((img) => img.imageUrl),
  );

  const attributes: Record<string, string> = {};
  for (const aspect of item.localizedAspects ?? []) {
    if (aspect.name && aspect.value && !(aspect.name in attributes)) {
      attributes[aspect.name] = aspect.value;
    }
  }
  const brand = attributes.Brand ?? attributes.Marke ?? attributes.Marque ?? null;

  const shippingCost = item.shippingOptions?.[0]?.shippingCost;
  const shippingValue = shippingCost?.value != null ? Number(shippingCost.value) : null;
  const shipping =
    shippingValue != null && Number.isFinite(shippingValue)
      ? {
          cost: shippingValue,
          currency: shippingCost?.currency ?? currency,
          free: shippingValue === 0,
          label: shippingValue === 0 ? 'Free shipping' : null,
        }
      : null;

  const seller = item.seller?.username
    ? {
        name: item.seller.username,
        type:
          item.seller.sellerAccountType === 'BUSINESS'
            ? ('business' as const)
            : item.seller.sellerAccountType === 'INDIVIDUAL'
              ? ('private' as const)
              : null,
        rating:
          item.seller.feedbackPercentage != null
            ? Number(item.seller.feedbackPercentage)
            : null,
        ratingScale: 'percent' as const,
        feedbackCount: item.seller.feedbackScore ?? null,
      }
    : null;

  const buyingOptions = (item.buyingOptions ?? []).map(
    (option) => BUYING_OPTION_LABELS[option] ?? option,
  );

  const category =
    item.categories?.[0]?.categoryName ??
    (item.categoryPath
      ? item.categoryPath.split('|').map((s) => s.trim()).filter(Boolean).pop() ?? null
      : null);

  const originalPrice =
    item.marketingPrice?.originalPrice?.value != null
      ? Number(item.marketingPrice.originalPrice.value)
      : null;

  const description =
    item.shortDescription?.trim() ||
    [condition, brand, category].filter(Boolean).join(' · ');

  return {
    id: `ebay:${item.itemId}`,
    source: 'ebay',
    sourceListingId: item.itemId,
    title: item.title,
    description,
    price: Number.isFinite(price as number) ? price : null,
    currency,
    location: location || null,
    imageUrl: images[0] ?? null,
    images,
    listingUrl: item.itemWebUrl,
    publishedAt: item.itemCreationDate ?? item.itemOriginDate ?? null,
    fetchedAt,
    condition,
    category,
    brand,
    seller,
    shipping,
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
    buyingOptions: buyingOptions.length > 0 ? buyingOptions : undefined,
    bids: item.bidCount ?? null,
    endsAt: item.itemEndDate ?? null,
    originalPrice: Number.isFinite(originalPrice as number) ? originalPrice : null,
  };
}

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
      'Fixed-price & auction listings',
      'Condition labels',
      'Seller & feedback',
      'Shipping cost',
      'Item aspects & brand',
      'Additional images',
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
    // EXTENDED adds seller, additional images, auction timing and item aspects.
    url.searchParams.set('fieldgroups', 'EXTENDED');

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
        signal: combineSignals(params.signal, AbortSignal.timeout(TIMEOUT_MS)),
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
      normalizeEbayItem(item, fetchedAt, market.currency),
    );
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
