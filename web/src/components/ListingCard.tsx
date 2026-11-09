import { useState } from 'react';
import type { NormalizedListing } from '../lib/types';
import { formatChf, sourceAccent, timeAgo } from '../lib/format';
import { Icon } from './Icon';
import styles from './ListingCard.module.css';

export function ListingCard({ listing, view, sourceLabel, sourceMode }: {
  listing: NormalizedListing; view: 'grid' | 'list'; sourceLabel: string; sourceMode: 'live' | 'sample';
}) {
  const [imgError, setImgError] = useState(false);
  const accent = sourceAccent(listing.source);
  const showImage = listing.imageUrl && !imgError;
  const converted = listing.marketPrice != null && listing.marketCurrency;
  const displayPrice = converted
    ? formatChf(listing.marketPrice!, listing.marketCurrency!)
    : listing.price != null ? formatChf(listing.price, listing.currency) : '—';
  let ctaLabel = 'Open ' + sourceLabel;
  if (sourceMode === 'sample') {
    try { ctaLabel = 'Search on ' + new URL(listing.listingUrl).hostname.replace('www.', ''); }
    catch { /* keep fallback label */ }
  }
  const freshnessLabel = listing.freshness === 'stale' ? 'Possibly outdated'
    : listing.freshness === 'aging' ? 'Older listing' : null;

  return (
    <article className={`${styles.card} ${view === 'list' ? styles.list : ''}`}>
      <div className={styles.inner}>
        <div className={styles.metaRow}>
          <div className={styles.metaLeft}>
            <span className={styles.sourceChip} style={{
              color: accent, background: 'color-mix(in srgb, currentColor 12%, transparent)',
              borderColor: 'color-mix(in srgb, currentColor 25%, transparent)',
            }}>
              <span className={styles.sourceDot} style={{ background: accent }} />{sourceLabel}
            </span>
            {listing.location && <span className={styles.location}>{listing.location}</span>}
            {freshnessLabel && <span className={styles.freshnessBadge} title={listing.ageDays == null ? 'Publication date is old' : 'Published ' + listing.ageDays + ' days ago'}>{freshnessLabel}</span>}
          </div>
        </div>
        <div className={styles.imageWrap}>
          {showImage ? <img className={styles.image} src={listing.imageUrl!} alt={listing.title} loading="lazy" referrerPolicy="no-referrer" onError={() => setImgError(true)} />
            : <div className={styles.imageFallback}><Icon name="image" size={28} style={{ color: 'var(--outline-variant)' }} /></div>}
          {listing.publishedAt && <span className={styles.timeBadge}>{timeAgo(listing.publishedAt)}</span>}
        </div>
        <div className={styles.titles}>
          <h2 className={`t-headline-sm ${styles.title}`}>{listing.title}</h2>
          {listing.description && <p className={`t-body-md ${styles.description}`}>{listing.description}</p>}
          {listing.duplicateListings && listing.duplicateListings.length > 0 && (
            <div className={styles.duplicateLinks}>
              Also listed on {listing.duplicateListings.map((duplicate, index) => (
                <span key={duplicate.source}>{index > 0 ? ', ' : ''}
                  <a href={duplicate.listingUrl} target="_blank" rel="noopener noreferrer">{duplicate.source}</a>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className={styles.footer}>
        <div className={styles.priceCol}>
          <span className={styles.priceLabel}>{converted ? 'Price · ' + listing.marketCurrency : 'Price'}</span>
          <span className={`t-price-card ${styles.price}`}>{displayPrice}</span>
          {listing.price != null && converted && listing.currency !== listing.marketCurrency && <span className={styles.originalPrice}>Original: {formatChf(listing.price, listing.currency)}</span>}
          {listing.price != null && !converted && listing.currency !== listing.marketCurrency && <span className={styles.originalPrice}>Currency conversion unavailable</span>}
        </div>
        <a className={styles.cta} href={listing.listingUrl} target="_blank" rel="noopener noreferrer">
          <span>{ctaLabel}</span><Icon name="north_east" size={14} />
        </a>
      </div>
    </article>
  );
}
