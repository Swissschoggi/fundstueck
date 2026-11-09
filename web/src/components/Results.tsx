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
  status, result, errorMessage, errorCode, marketLabel, view, filteredListings, onRetry,
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
    return <div className={styles.grid} aria-busy="true" aria-label="Loading results">
      {Array.from({ length: 9 }, (_, i) => <SkeletonCard key={i} />)}
    </div>;
  }

  if (status === 'error') {
    return <div className={styles.statePanel} role="alert">
      <div className={styles.stateIcon}><Icon name="error" size={26} style={{ color: 'var(--error)' }} /></div>
      <h2 className={`t-headline-md ${styles.stateTitle}`}>{errorCode === 'NO_SOURCES' ? 'No sources for this market' : 'Search failed'}</h2>
      <p className={`t-body-md ${styles.stateText}`}>{errorMessage}</p>
      <button type="button" className={styles.retryButton} onClick={onRetry}>Retry search</button>
    </div>;
  }

  if (status === 'idle') {
    const suggestions = [
      { label: '📱 iPhone 15', q: 'iPhone 15' },
      { label: '🪑 Vitra Chair', q: 'Vitra Chair' },
      { label: '🚴 Gravel Bike', q: 'Gravel Bike' },
      { label: '⌚ Rolex', q: 'Rolex' },
      { label: '💻 MacBook Pro', q: 'MacBook Pro' },
      { label: '🧱 Lego', q: 'Lego' },
    ];
    return <div className={styles.statePanel}>
      <div className={styles.stateIcon}><Icon name="manage_search" size={26} style={{ color: 'var(--outline)' }} /></div>
      <h2 className={`t-headline-md ${styles.stateTitle}`}>Search {marketLabel} marketplaces</h2>
      <p className={`t-body-md ${styles.stateText}`}>One query fans out to every connected marketplace. Results are normalised into a single feed — no listings are hosted here.</p>
      <div className={styles.suggestionChips}>
        {suggestions.map((sug) => <button key={sug.q} type="button" className={styles.suggestionChip} onClick={() => window.dispatchEvent(new CustomEvent('fundstueck:suggest', { detail: sug.q }))}>{sug.label}</button>)}
      </div>
    </div>;
  }

  if (!result) return null;
  const failedSources = result.sources.filter((s) => s.status === 'error' || s.status === 'timeout');
  const okSources = result.sources.filter((s) => s.status === 'ok');
  const sampleSources = okSources.filter((s) => s.mode === 'sample' && (s.count ?? 0) > 0);
  const timeoutCount = result.sources.filter((s) => s.status === 'timeout').length;
  const failedCount = result.sources.filter((s) => s.status === 'error').length;

  return <div className={styles.resultsStack}>
    <div className={styles.headerRow}>
      <div className={styles.headerLeft}>
        <h1 className={`t-headline-md ${styles.headerTitle}`}>Results</h1>
        <span className={`t-code-chf ${styles.headerMeta}`}>
          {result.total} listing{result.total === 1 ? '' : 's'} · {result.tookMs}ms
          {result.duplicatesRemoved ? ` · ${result.duplicatesRemoved} duplicates merged` : ''}
        </span>
      </div>
      {failedSources.map((s) => <span key={s.source} className={styles.degraded} title={s.error}>
        <Icon name={s.status === 'timeout' ? 'schedule' : 'error'} size={14} style={{ color: 'var(--error)' }} />
        {s.label} {s.status === 'timeout' ? 'timed out' : 'unavailable'}
      </span>)}
    </div>

    {(failedCount > 0 || timeoutCount > 0 || result.sources.length > 0) && (
      <details className={styles.diagnostics}>
        <summary>Search diagnostics · {okSources.length}/{result.sources.length} sources responded</summary>
        <div className={styles.diagnosticSummary}>
          <span>{okSources.length} successful</span>
          {failedCount > 0 && <span>{failedCount} failed</span>}
          {timeoutCount > 0 && <span>{timeoutCount} timed out</span>}
          <span>{result.rawTotal ?? result.total} raw results</span>
          <span>{result.duplicatesRemoved ?? 0} duplicates merged</span>
        </div>
        <div className={styles.diagnosticRows}>
          {result.sources.map((source) => <div key={source.source} className={styles.diagnosticRow}>
            <span>{source.label}</span>
            <span>{source.status === 'ok' ? `${source.count ?? 0} results` : source.status === 'timeout' ? 'Timed out' : source.status === 'error' ? 'Failed' : 'Not queried'}</span>
            <span>{source.latencyMs != null ? `${source.latencyMs} ms` : '—'}</span>
            {source.error && <span className={styles.diagnosticError} title={source.error}>{source.error}</span>}
          </div>)}
        </div>
      </details>
    )}

    {sampleSources.length > 0 && result.total > 0 && <div className={styles.sampleBanner} role="note">
      <Icon name="science" size={16} style={{ color: 'var(--outline)' }} />
      <span>{result.isSampleData
        ? 'Showing sample data — representative test listings from the dev adapter. Enable a live adapter or configure eBay credentials for real results.'
        : 'Sample adapter contributes part of these results; sample listings are labelled.'}</span>
    </div>}

    {filteredListings.length === 0 ? <div className={styles.statePanel}>
      <div className={styles.stateIcon}><Icon name="search_off" size={26} style={{ color: 'var(--outline)' }} /></div>
      <h2 className={`t-headline-md ${styles.stateTitle}`}>No listings found</h2>
      <p className={`t-body-md ${styles.stateText}`}>Nothing matched “{result.query}”. Try a broader term, remove price filters, or check configured marketplace sources.</p>
    </div> : <div className={view === 'grid' ? styles.grid : styles.listColumn}>
      {filteredListings.map((l) => {
        const src = result.sources.find((s) => s.source === l.source);
        return <ListingCard key={l.id} listing={l} view={view} sourceLabel={src?.label ?? l.source} sourceMode={src?.mode ?? 'live'} />;
      })}
    </div>}
  </div>;
}
