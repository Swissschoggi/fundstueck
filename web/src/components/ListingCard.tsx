import { useState, useRef, useEffect } from 'react';
import type { NormalizedListing } from '../lib/types';
import { formatChf, sourceAccent, timeAgo } from '../lib/format';
import { Icon } from './Icon';
import { useFavorites } from '../contexts/FavoritesContext';
import styles from './ListingCard.module.css';

export function ListingCard({ listing, view, sourceLabel, sourceMode, imageSearchTemplate, onAiSimilar, aiBusy }: {
  listing: NormalizedListing; view: 'grid' | 'list'; sourceLabel: string; sourceMode: 'live' | 'sample';
  imageSearchTemplate?: string | null;
  onAiSimilar?: (listing: NormalizedListing) => void;
  aiBusy?: boolean;
}) {
  const [imgError, setImgError] = useState(false);
  const [similarOpen, setSimilarOpen] = useState(false);
  const similarRef = useRef<HTMLDivElement>(null);
  const hasAi = (() => {
    try {
      const raw = localStorage.getItem('fundstueck:aiConfig');
      if (!raw) return false;
      const cfg = JSON.parse(raw);
      return Boolean(cfg?.endpoint && cfg?.model);
    } catch { return false; }
  })();
  const { isSaved, toggle } = useFavorites();

  useEffect(() => {
    if (!similarOpen) return;
    const handler = (e: MouseEvent) => {
      if (similarRef.current && !similarRef.current.contains(e.target as Node)) setSimilarOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [similarOpen]);
  const favorited = isSaved(listing.id);
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
            {listing.duplicateCount && listing.duplicateCount > 0 && (
              <span className={styles.duplicates} title={(listing.duplicateListings ?? []).map((d) => d.source).join(', ')}>
                +{listing.duplicateCount} duplicate{listing.duplicateCount === 1 ? '' : 's'} on {(listing.duplicateListings ?? []).map((d) => d.source).join(', ')}
              </span>
            )}
            {freshnessLabel && <span className={styles.freshnessBadge} title={listing.ageDays == null ? 'Publication date is old' : 'Published ' + listing.ageDays + ' days ago'}>{freshnessLabel}</span>}
          </div>
          <button
            type="button"
            className={`${styles.favBtn} ${favorited ? styles.favActive : ''}`}
            aria-label={favorited ? 'Saved' : 'Save listing'}
            onClick={async () => {
              await toggle(listing);
            }}
          >
            <Icon name={favorited ? 'favorite' : 'favorite_border'} size={20} />
          </button>
        </div>
        <div className={styles.imageWrap}>
          {showImage ? <img className={styles.image} src={listing.imageUrl!} alt={listing.title} loading="lazy" referrerPolicy="no-referrer" onError={() => setImgError(true)} />
            : <div className={styles.imageFallback}><Icon name="image" size={28} style={{ color: 'var(--outline-variant)' }} /></div>}
          {listing.publishedAt && <span className={styles.timeBadge}>{timeAgo(listing.publishedAt)}</span>}
        </div>
        <div className={styles.titles}>
          <h2 className={`t-headline-sm ${styles.title}`}>{listing.title}</h2>
          {listing.description && <p className={`t-body-md ${styles.description}`}>{listing.description}</p>}

        </div>
      </div>
      <div className={styles.footer}>
        {listing.imageUrl && (
          <div className={styles.similarWrap} ref={similarRef}>
            <button
              type="button"
              className={styles.similarBtn}
              onClick={() => setSimilarOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={similarOpen}
              aria-label="Find similar images"
              disabled={aiBusy}
            >
              {aiBusy ? <Icon name="progress_activity" size={16} /> : <Icon name="travel_explore" size={16} />} {aiBusy ? 'Finding similar…' : 'Find similar'}
            </button>
            {similarOpen && (
              <div className={styles.similarMenu} role="menu">
                {hasAi && onAiSimilar && (
                  <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); e.preventDefault(); onAiSimilar(listing); setSimilarOpen(false); }}>
                    {aiBusy ? 'Finding similar…' : 'AI similar (vision)'}
                  </button>
                )}
                {imageSearchTemplate && (
                  <a href={imageSearchTemplate.replace('{image}', encodeURIComponent(listing.imageUrl))} target="_blank" rel="noopener noreferrer" role="menuitem">Fundstück engine</a>
                )}
                <a href={`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(listing.imageUrl)}`} target="_blank" rel="noopener noreferrer" role="menuitem">Google Lens</a>
                <a href={`https://www.google.com/searchbyimage?image_url=${encodeURIComponent(listing.imageUrl)}`} target="_blank" rel="noopener noreferrer" role="menuitem">Google Images</a>
                <a href={`https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(listing.imageUrl)}`} target="_blank" rel="noopener noreferrer" role="menuitem">Yandex</a>
                <a href={`https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${encodeURIComponent(listing.imageUrl)}`} target="_blank" rel="noopener noreferrer" role="menuitem">Bing</a>
                <a href={`https://tineye.com/search?url=${encodeURIComponent(listing.imageUrl)}`} target="_blank" rel="noopener noreferrer" role="menuitem">TinEye</a>
              </div>
            )}
          </div>
        )}
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
