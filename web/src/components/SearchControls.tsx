import { forwardRef } from 'react';
import type { MarketInfo, SortKey, ViewMode } from '../lib/types';
import { Icon } from './Icon';
import styles from './SearchControls.module.css';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'best', label: 'Best match' },
  { value: 'newest', label: 'Newly listed' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
];

export const SearchControls = forwardRef<
  HTMLInputElement,
  {
    input: string;
    onInputChange: (v: string) => void;
    onSubmit: () => void;
    market: string;
    markets: MarketInfo[];
    marketLabel: string;
    onMarketChange: (code: string) => void;
    sort: SortKey;
    onSortChange: (s: SortKey) => void;
    view: ViewMode;
    onViewChange: (v: ViewMode) => void;
    isSearching: boolean;
  }
>(function SearchControls(
  {
    input,
    onInputChange,
    onSubmit,
    market,
    markets,
    marketLabel,
    onMarketChange,
    sort,
    onSortChange,
    view,
    onViewChange,
    isSearching,
  },
  inputRef,
) {
  return (
    <div className={styles.strip}>
      <form
        className={styles.searchForm}
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div className={styles.searchField}>
          <Icon name="search" size={20} style={{ color: 'var(--outline)' }} />
          <input
            ref={inputRef}
            type="text"
            className={styles.input}
            placeholder={`Search ${marketLabel} marketplaces (e.g. ThinkPad, USM Haller, Leica M6)…`}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            aria-label="Search query"
            autoComplete="off"
            spellCheck={false}
          />
          {isSearching && <span className={styles.spinner} aria-label="Searching" />}
          <span className={styles.kbd}>⌘K</span>
        </div>
      </form>

      <div className={styles.controls}>
        <div className={styles.selectWrap}>
          <Icon
            name="public"
            size={16}
            style={{
              color: 'var(--outline)',
              position: 'absolute',
              left: 10,
              pointerEvents: 'none',
            }}
          />
          <select
            className={`${styles.select} ${styles.marketSelect}`}
            value={market}
            onChange={(e) => onMarketChange(e.target.value)}
            aria-label="Buyer market"
            title="Choose which country's marketplaces to search"
          >
            {markets.length === 0 ? (
              <option value={market}>{market}</option>
            ) : (
              markets.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.label} · {m.currency}
                  {m.sources.enabled === 0 ? ' · no sources yet' : ''}
                </option>
              ))
            )}
          </select>
          <Icon name="expand_more" size={18} style={{ color: 'var(--outline)' }} />
        </div>

        <div className={styles.selectWrap}>
          <select
            className={styles.select}
            value={sort}
            onChange={(e) => onSortChange(e.target.value as SortKey)}
            aria-label="Sort results"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <Icon name="expand_more" size={18} style={{ color: 'var(--outline)' }} />
        </div>

        <div className={styles.viewToggle} role="group" aria-label="Result view">
          <button
            type="button"
            className={`${styles.viewBtn} ${view === 'grid' ? styles.viewActive : ''}`}
            title="Grid view"
            onClick={() => onViewChange('grid')}
          >
            <Icon name="grid_view" size={18} />
          </button>
          <button
            type="button"
            className={`${styles.viewBtn} ${view === 'list' ? styles.viewActive : ''}`}
            title="List view"
            onClick={() => onViewChange('list')}
          >
            <Icon name="view_agenda" size={18} />
          </button>
        </div>
      </div>
    </div>
  );
});
