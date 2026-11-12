import { useEffect, useMemo, useState } from 'react';
import type { NormalizedListing, PriceHistoryResponse } from '../lib/types';
import { fetchListingHistory } from '../lib/api';
import { formatChf, timeAgo } from '../lib/format';
import { useFavorites } from '../contexts/FavoritesContext';
import { Icon } from './Icon';
import styles from './ListingDetail.module.css';

interface CompareRow {
  source: string;
  listingUrl: string;
  title: string;
  price: number | null;
  currency: string;
  location: string | null;
  imageUrl: string | null;
  matchScore?: number;
  matchReason?: string;
  isPrimary: boolean;
}

const REASON_LABEL: Record<string, string> = {
  'same-url': 'Identical listing URL',
  'same-image': 'Identical product image',
  'title-match': 'Matching title',
  'title-price': 'Matching title & price',
};

function buildRows(listing: NormalizedListing): CompareRow[] {
  const rows: CompareRow[] = [{
    source: listing.source,
    listingUrl: listing.listingUrl,
    title: listing.title,
    price: listing.price,
    currency: listing.currency,
    location: listing.location,
    imageUrl: listing.imageUrl,
    isPrimary: true,
  }];
  for (const d of listing.duplicateListings ?? []) {
    rows.push({
      source: d.source,
      listingUrl: d.listingUrl,
      title: d.title ?? listing.title,
      price: d.price ?? null,
      currency: d.currency ?? listing.currency,
      location: d.location ?? null,
      imageUrl: d.imageUrl ?? null,
      matchScore: d.matchScore,
      matchReason: d.matchReason,
      isPrimary: false,
    });
  }
  return rows;
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = 400 / (values.length - 1);
  const points = values.map((v, i) => `${i * step},${52 - ((v - min) / span) * 44}`);
  const path = `M ${points.join(' L ')}`;
  return (
    <svg className={styles.sparkline} viewBox="0 0 400 60" preserveAspectRatio="none">
      <line x1="0" x2="400" y1="30" y2="30" stroke="currentColor" strokeOpacity="0.15" strokeDasharray="4 4" />
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ListingDetail({
  listing,
  sourceLabelFor,
  onBack,
  onOpenCompare,
}: {
  listing: NormalizedListing;
  sourceLabelFor: (source: string) => string;
  onBack: () => void;
  onOpenCompare: () => void;
}) {
  const gallery = useMemo(
    () => (listing.images?.length ? listing.images : listing.imageUrl ? [listing.imageUrl] : []),
    [listing.images, listing.imageUrl],
  );
  const [imgError, setImgError] = useState(false);
  const [activeImage, setActiveImage] = useState<string | null>(gallery[0] ?? null);
  const [history, setHistory] = useState<PriceHistoryResponse | null>(null);
  const { isSaved, toggle } = useFavorites();
  const saved = isSaved(listing.id);

  useEffect(() => {
    setImgError(false);
    setActiveImage(listing.images?.[0] ?? listing.imageUrl ?? null);
    fetchListingHistory(listing.id).then(setHistory).catch(() => setHistory(null));
  }, [listing.id, listing.images, listing.imageUrl]);

  const rows = useMemo(() => buildRows(listing), [listing]);
  const priced = rows.filter((r) => r.price != null) as Array<CompareRow & { price: number }>;
  const cheapest = priced.reduce<CompareRow | null>(
    (best, r) => (best == null || (r.price != null && r.price < (best.price ?? Infinity)) ? r : best),
    null,
  );
  const groupStats = priced.length >= 2
    ? {
        min: Math.min(...priced.map((r) => r.price)),
        max: Math.max(...priced.map((r) => r.price)),
        avg: priced.reduce((a, r) => a + r.price, 0) / priced.length,
      }
    : null;

  const displayPrice = listing.marketPrice != null && listing.marketCurrency
    ? formatChf(listing.marketPrice, listing.marketCurrency)
    : listing.price != null ? formatChf(listing.price, listing.currency) : 'Price unavailable';

  const shippingText = listing.shipping
    ? listing.shipping.free || listing.shipping.cost === 0
      ? 'Free shipping'
      : listing.shipping.label ??
        (listing.shipping.cost != null
          ? formatChf(listing.shipping.cost, listing.shipping.currency ?? listing.currency)
          : 'Details on listing')
    : null;

  const rawSpecs = [
    ...(listing.condition ? [{ label: 'Condition', value: listing.condition }] : []),
    { label: 'Source', value: sourceLabelFor(listing.source) },
    ...(listing.brand ? [{ label: 'Brand', value: listing.brand }] : []),
    ...(listing.category ? [{ label: 'Category', value: listing.category }] : []),
    ...(listing.buyingOptions?.length
      ? [{ label: 'Format', value: listing.buyingOptions.join(' · ') }]
      : []),
    ...(listing.bids != null ? [{ label: 'Bids', value: String(listing.bids) }] : []),
    ...(listing.endsAt
      ? [{ label: 'Ends', value: new Date(listing.endsAt).toLocaleString() }]
      : []),
    ...(listing.availability ? [{ label: 'Availability', value: listing.availability }] : []),
    ...(shippingText ? [{ label: 'Shipping', value: shippingText }] : []),
    { label: 'Currency', value: listing.marketCurrency ?? listing.currency },
    { label: 'Posted', value: listing.publishedAt ? timeAgo(listing.publishedAt) : 'Unknown' },
    { label: 'Freshness', value: listing.freshness ?? 'unknown' },
    ...(listing.size ? [{ label: 'Size', value: listing.size }] : []),
    ...(listing.gender ? [{ label: 'Audience', value: listing.gender }] : []),
    ...Object.entries(listing.attributes ?? {}).map(([label, value]) => ({ label, value })),
  ];

  const seenSpecs = new Set<string>();
  const specs = rawSpecs.filter((spec) => {
    if (!spec.value || seenSpecs.has(spec.label)) return false;
    seenSpecs.add(spec.label);
    return true;
  });

  const historyValues = history?.history.map((p) => p.price) ?? [];
  const stats = history?.stats;

  return (
    <div className={styles.page}>
      <div className={styles.bar}>
        <button type="button" className={styles.back} onClick={onBack}>
          <Icon name="arrow_back" size={16} /> Back to results
        </button>
        <span className={styles.idChip}>ID: {listing.id}</span>
        {listing.publishedAt && <span className={styles.discovered}>Posted {timeAgo(listing.publishedAt)}</span>}
        <div className={styles.barActions}>
          <button
            type="button"
            className={`${styles.barBtn} ${saved ? styles.saved : ''}`}
            onClick={() => void toggle(listing)}
          >
            <Icon name={saved ? 'favorite' : 'favorite_border'} size={16} />
            {saved ? 'Saved' : 'Save'}
          </button>
          <a className={styles.barBtn} href={listing.listingUrl} target="_blank" rel="noopener noreferrer">
            <Icon name="open_in_new" size={16} /> Open listing
          </a>
        </div>
      </div>

      <div className={styles.grid}>
        <div className={styles.left}>
          <div className={styles.media}>
            <div className={styles.stage}>
              {activeImage && !imgError ? (
                <img src={activeImage} alt={listing.title} referrerPolicy="no-referrer" onError={() => setImgError(true)} />
              ) : (
                <div className={styles.stageFallback}><Icon name="image" size={40} style={{ color: 'var(--outline-variant)' }} /></div>
              )}
              <div className={styles.stageBadges}>
                <span className={styles.stageChip}>{sourceLabelFor(listing.source)}</span>
                {listing.condition && <span className={styles.stageChip}>{listing.condition}</span>}
                {listing.freshness && <span className={styles.stageChip}>{listing.freshness}</span>}
              </div>
            </div>
            {gallery.length > 1 && (
              <div className={styles.thumbs}>
                {gallery.map((url, i) => (
                  <button
                    key={`${url}-${i}`}
                    type="button"
                    className={`${styles.thumb} ${activeImage === url ? styles.thumbActive : ''}`}
                    onClick={() => { setActiveImage(url); setImgError(false); }}
                    aria-label={`Show image ${i + 1}`}
                  >
                    <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={styles.meta}>
            <span className={styles.eyebrow}>{sourceLabelFor(listing.source)} listing</span>
            <h1 className={styles.title}>{listing.title}</h1>
            {listing.description && <p className={styles.description}>{listing.description}</p>}

            {listing.location && (
              <div className={styles.locationCard}>
                <span className={styles.locationIcon}><Icon name="location_on" size={20} /></span>
                <div>
                  <span className={styles.locationMain}>{listing.location}</span>
                  <span className={styles.locationSub}>Listing location</span>
                </div>
              </div>
            )}

            <div className={styles.specsHead}>Listing details</div>
            <div className={styles.specs}>
              {specs.map((s) => (
                <div key={s.label} className={styles.spec}>
                  <span className={styles.specLabel}>{s.label}</span>
                  <span className={styles.specValue}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.right}>
          <div className={styles.priceCard}>
            <span className={styles.priceLabel}>
              {listing.buyingOptions?.includes('Auction') ? 'Current bid' : 'Asking price'}
            </span>
            <span className={styles.price}>{displayPrice}</span>
            {listing.price != null && listing.marketPrice != null && listing.currency !== listing.marketCurrency && (
              <span className={styles.priceOriginal}>Original {formatChf(listing.price, listing.currency)}</span>
            )}
            {listing.originalPrice != null && listing.originalPrice > (listing.price ?? 0) && (
              <span className={styles.priceWas}>
                Was {formatChf(listing.originalPrice, listing.currency)}
              </span>
            )}
            {shippingText && <span className={styles.priceShip}>{shippingText}</span>}
            {listing.endsAt && (
              <span className={styles.auctionNote}>
                {listing.bids != null ? `${listing.bids} bids · ` : ''}
                Ends {new Date(listing.endsAt).toLocaleString()}
              </span>
            )}
            <a className={styles.priceCta} href={listing.listingUrl} target="_blank" rel="noopener noreferrer">
              Open on {sourceLabelFor(listing.source)} <Icon name="north_east" size={14} />
            </a>
          </div>

          {listing.seller && (
            <div className={styles.sellerCard}>
              <span className={styles.sellerAvatar}>
                <Icon name="storefront" size={20} />
              </span>
              <div className={styles.sellerInfo}>
                <span className={styles.sellerName}>{listing.seller.name}</span>
                <span className={styles.sellerMeta}>
                  {listing.seller.type === 'business' ? 'Business seller' : 'Private seller'}
                  {listing.seller.rating != null &&
                    (listing.seller.ratingScale === 'percent'
                      ? ` · ${listing.seller.rating}% positive`
                      : ` · ${listing.seller.rating}★`)}
                  {listing.seller.feedbackCount != null
                    ? ` · ${listing.seller.feedbackCount} reviews`
                    : ''}
                </span>
              </div>
            </div>
          )}

          {rows.length > 1 && (
            <div className={styles.duplicateBanner}>
              <div className={styles.duplicateHead}>
                <Icon name="hub" size={18} />
                <span>Cross-marketplace match</span>
                <button type="button" className={styles.compareLink} onClick={onOpenCompare}>Compare</button>
              </div>
              <p className={styles.duplicateText}>
                Same item found on {rows.length} marketplaces.
                {cheapest && cheapest.price != null && (
                  <> Cheapest: <strong>{formatChf(cheapest.price, cheapest.currency)}</strong> on {sourceLabelFor(cheapest.source)}.</>
                )}
              </p>
            </div>
          )}

          <div className={styles.compareList}>
            {rows.map((r, i) => {
              const isCheapest = cheapest != null && r.price === cheapest.price;
              return (
                <div key={`${r.source}-${i}`} className={`${styles.compareRow} ${isCheapest && rows.length > 1 ? styles.compareBest : ''}`}>
                  <div className={styles.compareTop}>
                    <span className={styles.compareSource}>{sourceLabelFor(r.source)}</span>
                    {isCheapest && rows.length > 1 && <span className={styles.bestBadge}>Best price</span>}
                    {r.matchScore != null && (
                      <span className={styles.matchScore} title={r.matchReason ? REASON_LABEL[r.matchReason] ?? r.matchReason : undefined}>
                        {Math.round(r.matchScore * 100)}% match
                      </span>
                    )}
                  </div>
                  <div className={styles.compareBottom}>
                    <span className={styles.comparePrice}>
                      {r.price != null ? formatChf(r.price, r.currency) : '—'}
                    </span>
                    <a className={styles.compareCta} href={r.listingUrl} target="_blank" rel="noopener noreferrer">
                      Open <Icon name="north_east" size={13} />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>

          <div className={styles.historyCard}>
            <div className={styles.historyHead}>
              <span className={styles.historyTitle}>Price history</span>
              <span className={styles.historyMeta}>
                {stats && stats.count > 0 ? `${stats.count} observation${stats.count === 1 ? '' : 's'}` : 'No data yet'}
              </span>
            </div>
            {stats && stats.count > 0 ? (
              <>
                {historyValues.length >= 2 && <Sparkline values={historyValues} />}
                <div className={styles.historyStats}>
                  <div><span>Min</span><strong>{stats?.min != null ? formatChf(stats.min, stats.currency ?? listing.currency) : '—'}</strong></div>
                  <div><span>Avg</span><strong>{stats?.avg != null ? formatChf(stats.avg, stats.currency ?? listing.currency) : '—'}</strong></div>
                  <div><span>Max</span><strong>{stats?.max != null ? formatChf(stats.max, stats.currency ?? listing.currency) : '—'}</strong></div>
                </div>
              </>
            ) : groupStats ? (
              <>
                <p className={styles.historyHint}>Comparable asking prices across matched listings</p>
                <div className={styles.historyStats}>
                  <div><span>Min</span><strong>{formatChf(groupStats.min, listing.currency)}</strong></div>
                  <div><span>Avg</span><strong>{formatChf(groupStats.avg, listing.currency)}</strong></div>
                  <div><span>Max</span><strong>{formatChf(groupStats.max, listing.currency)}</strong></div>
                </div>
              </>
            ) : (
              <p className={styles.historyHint}>
                Price history builds up as this listing appears in future searches. No comparison points yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
