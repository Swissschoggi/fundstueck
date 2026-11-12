import { useEffect } from 'react';
import type { NormalizedListing } from '../lib/types';
import { formatChf } from '../lib/format';
import { Icon } from './Icon';
import styles from './ListingComparison.module.css';

const REASON_LABEL: Record<string, string> = {
  'same-url': 'Identical listing URL',
  'same-image': 'Identical product image',
  'title-match': 'Matching title',
  'title-price': 'Matching title & price',
};

interface CompareRow {
  source: string;
  title: string;
  listingUrl: string;
  price: number | null;
  currency: string;
  location: string | null;
  matchScore?: number;
  matchReason?: string;
}

function buildRows(listing: NormalizedListing): CompareRow[] {
  const rows: CompareRow[] = [{
    source: listing.source,
    title: listing.title,
    listingUrl: listing.listingUrl,
    price: listing.price,
    currency: listing.currency,
    location: listing.location,
  }];
  for (const d of listing.duplicateListings ?? []) {
    rows.push({
      source: d.source,
      title: d.title ?? listing.title,
      listingUrl: d.listingUrl,
      price: d.price ?? null,
      currency: d.currency ?? listing.currency,
      location: d.location ?? null,
      matchScore: d.matchScore,
      matchReason: d.matchReason,
    });
  }
  return rows.sort((a, b) => {
    if (a.price == null && b.price == null) return 0;
    if (a.price == null) return 1;
    if (b.price == null) return -1;
    return a.price - b.price;
  });
}

export function ListingComparison({
  listing,
  sourceLabelFor,
  onClose,
}: {
  listing: NormalizedListing;
  sourceLabelFor: (source: string) => string;
  onClose: () => void;
}) {
  const rows = buildRows(listing);
  const priced = rows.filter((r) => r.price != null);
  const cheapest = priced[0] ?? null;
  const mostExpensive = priced[priced.length - 1] ?? null;
  const delta =
    cheapest && mostExpensive && cheapest.price != null && mostExpensive.price != null
      ? mostExpensive.price - cheapest.price
      : 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Cross-marketplace duplicate comparison" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.sheet}>
        <header className={styles.header}>
          <div className={styles.headerTitle}>
            <span className={styles.hubIcon}><Icon name="hub" size={20} /></span>
            <div>
              <span className={styles.eyebrow}>Cross-marketplace duplicate matched</span>
              <h2 className={styles.title}>{listing.title}</h2>
            </div>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close comparison">
            <Icon name="close" size={20} />
          </button>
        </header>

        {delta > 0 && (
          <div className={styles.deltaBanner}>
            <Icon name="trending_down" size={16} />
            <span>Same item listed at {rows.length} sources · up to {formatChf(delta, cheapest?.currency ?? listing.currency)} cheaper</span>
          </div>
        )}

        <div className={styles.rows}>
          {rows.map((row, i) => {
            const isCheapest = cheapest != null && row.price === cheapest.price;
            return (
              <div key={`${row.source}-${row.listingUrl}-${i}`} className={`${styles.row} ${isCheapest ? styles.cheapest : ''}`}>
                <div className={styles.rowTop}>
                  <span className={styles.sourceChip}>{sourceLabelFor(row.source)}</span>
                  {isCheapest && priced.length > 1 && <span className={styles.bestBadge}>Best price</span>}
                  {row.matchScore != null && (
                    <span className={styles.matchScore} title={row.matchReason ? REASON_LABEL[row.matchReason] ?? row.matchReason : undefined}>
                      {Math.round(row.matchScore * 100)}% match
                    </span>
                  )}
                </div>
                <div className={styles.rowBody}>
                  <div className={styles.rowInfo}>
                    <span className={styles.rowPrice}>
                      {row.price != null ? formatChf(row.price, row.currency) : 'Price unavailable'}
                    </span>
                    {row.location && <span className={styles.rowLocation}>{row.location}</span>}
                    {row.matchReason && <span className={styles.rowReason}>{REASON_LABEL[row.matchReason] ?? row.matchReason}</span>}
                  </div>
                  <a className={styles.rowCta} href={row.listingUrl} target="_blank" rel="noopener noreferrer">
                    Open on {sourceLabelFor(row.source)}
                    <Icon name="north_east" size={14} />
                  </a>
                </div>
              </div>
            );
          })}
        </div>

        <footer className={styles.footer}>
          <span className={styles.footNote}>
            Matched by listing URL, product image and title similarity. Always verify the item is identical before contacting a seller.
          </span>
        </footer>
      </div>
    </div>
  );
}
