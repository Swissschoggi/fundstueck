import type { SearchResponse, ViewMode } from '../lib/types';
import { ListingCard } from './ListingCard';
import { Icon } from './Icon';
import styles from './Results.module.css';

function SkeletonCard() {
  return (
    <div className={styles.skeleton}>
      <div className={`${styles.shimmer} ${styles.skLine}`} style={{ width: '45%' }} />
      <div className={`${styles.shimmer} ${styles.skImage}`} />
      <div className={`${styles.shimmer} ${styles.skLine}`} style={{ width: '80%' }} />
      <div className={`${styles.shimmer} ${styles.skLine}`} style={{ width: '60%' }} />
      <div className={styles.skFooter}>
        <div className={`${styles.shimmer} ${styles.skLine}`} style={{ width: 70 }} />
        <div className={`${styles.shimmer} ${styles.skButton}`} />
      </div>
    </div>
  );
}

export function Results({
  status,
  result,
  errorMessage,
  errorCode,
  marketLabel,
  view,
  filteredListings,
  onRetry,
}: {
  status: 'idle' | 'loading' | 'success' | 'error';
  result: SearchResponse | null;
  errorMessage: string | null;
  errorCode?: string | null;
  marketLabel: string;
  view: ViewMode;
  filteredListings: SearchResponse['listings'];
  onRetry: () => void;
}) {
  if (status === 'loading') {
    return (
      <div className={styles.grid} aria-busy="true" aria-label="Loading results">
        {Array.from({ length: 9 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className={styles.statePanel} role="alert">
        <div className={styles.stateIcon}>
          <Icon name="error" size={26} style={{ color: 'var(--error)' }} />
        </div>
        <h2 className={`t-headline-md ${styles.stateTitle}`}>
          {errorCode === 'NO_SOURCES' ? 'No sources for this market' : 'Search failed'}
        </h2>
        <p className={`t-body-md ${styles.stateText}`}>{errorMessage}</p>
        <button type="button" className={styles.retryButton} onClick={onRetry}>
          Retry search
        </button>
      </div>
    );
  }

  if (status === 'idle') {
    const suggestions = ['iPhone 15', 'Vitra Chair', 'Gravel Bike', 'Rolex', 'MacBook Pro', 'Lego'];
    return (
      <div className={styles.statePanel}>
        <div className={styles.stateIcon}>
          <Icon name="manage_search" size={26} style={{ color: 'var(--outline)' }} />
        </div>
        <h2 className={`t-headline-md ${styles.stateTitle}`}>
          Search {marketLabel} marketplaces
        </h2>
        <p className={`t-body-md ${styles.stateText}`}>
          One query fans out to every connected marketplace. Results are normalised
          into a single feed — no listings are hosted here.
        </p>
        <div className={styles.suggestionChips}>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className={styles.suggestionChip}
              onClick={() => {
                const ev = new CustomEvent('fundstueck:suggest', { detail: s });
                window.dispatchEvent(ev);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!result) return null;

  const failedSources = result.sources.filter((s) => s.status === 'error');
  const okSources = result.sources.filter((s) => s.status === 'ok');
  const sampleSources = okSources.filter((s) => s.mode === 'sample' && (s.count ?? 0) > 0);

  return (
    <div className={styles.resultsStack}>
      <div className={styles.headerRow}>
        <div className={styles.headerLeft}>
          <h1 className={`t-headline-md ${styles.headerTitle}`}>Results</h1>
          <span className={`t-code-chf ${styles.headerMeta}`}>
            {result.total} listing{result.total === 1 ? '' : 's'} · {result.tookMs}ms
          </span>
        </div>
        {failedSources.map((s) => (
          <span key={s.source} className={styles.degraded} title={s.error}>
            <Icon name="error" size={14} style={{ color: 'var(--error)' }} />
            {s.label} unavailable
          </span>
        ))}
      </div>

      {sampleSources.length > 0 && result.total > 0 && (
        <div className={styles.sampleBanner} role="note">
          <Icon name="science" size={16} style={{ color: 'var(--outline)' }} />
          <span>
            {result.isSampleData
              ? 'Showing sample data — representative test listings from the dev adapter. Enable a live adapter or configure eBay credentials for real results.'
              : 'Sample adapter contributes part of these results; sample listings are labelled.'}
          </span>
        </div>
      )}

      {filteredListings.length === 0 ? (
        <div className={styles.statePanel}>
          <div className={styles.stateIcon}>
            <Icon name="search_off" size={26} style={{ color: 'var(--outline)' }} />
          </div>
          <h2 className={`t-headline-md ${styles.stateTitle}`}>No listings found</h2>
          <p className={`t-body-md ${styles.stateText}`}>
            Nothing matched “{result.query}”. Try a broader term, remove price filters,
            or check configured marketplace sources.
          </p>
        </div>
      ) : (
        <div className={view === 'grid' ? styles.grid : styles.listColumn}>
          {filteredListings.map((l) => {
            const src = result.sources.find((s) => s.source === l.source);
            return (
              <ListingCard
                key={l.id}
                listing={l}
                view={view}
                sourceLabel={src?.label ?? l.source}
                sourceMode={src?.mode ?? 'live'}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
