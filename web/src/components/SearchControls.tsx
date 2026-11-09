import { forwardRef, useEffect, useState } from 'react';
import type { CategoryOption, MarketInfo, SortKey, ViewMode } from '../lib/types';
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
    onClear?: () => void;
    market?: string;
    markets?: MarketInfo[];
    marketLabel?: string;
    onMarketChange?: (code: string) => void;
    sort: SortKey;
    onSortChange: (s: SortKey) => void;
    category: string;
    categories: CategoryOption[];
    onCategoryChange: (c: string) => void;
    view: ViewMode;
    onViewChange: (v: ViewMode) => void;
    isSearching: boolean;
  }
>(function SearchControls(
  {
    input,
    onInputChange,
    onSubmit,
    onClear,
    market: _market,
    markets: _markets,
    marketLabel: _marketLabel,
    onMarketChange: _onMarketChange,
    sort,
    onSortChange,
    category,
    categories,
    onCategoryChange,
    view,
    onViewChange,
    isSearching,
  },
  inputRef,
) {
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const suggestions = [
    "Search 'Herman Miller'…",
    "Search 'Rolex Submariner'…",
    "Search 'Gravel Bike'…",
    "Search 'Vitra Chair'…",
    "Search 'iPhone 15'…",
  ];
  const activeFilters = (category ? 1 : 0) + (sort !== 'best' ? 1 : 0);
  useEffect(() => {
    const id = window.setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % suggestions.length);
    }, 3500);
    return () => window.clearInterval(id);
  }, []);

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
            placeholder={suggestions[placeholderIdx]}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            aria-label="Search query"
            autoComplete="off"
            spellCheck={false}
          />
          {input && (
            <button
              type="button"
              className={styles.clearBtn}
              aria-label="Clear search"
              onClick={() => {
                onInputChange('');
                onClear?.();
              }}
            >
              <Icon name="close" size={18} />
            </button>
          )}
          {isSearching && <span className={styles.spinner} aria-label="Searching" />}
          <span className={styles.kbd}>⌘K</span>
        </div>
      </form>

      <div className={styles.controlsRow}>
        <button
          type="button"
          className={`${styles.filtersBtn} ${activeFilters > 0 ? styles.filtersActive : ''}`}
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <Icon name="tune" size={16} />
          Filters{activeFilters > 0 ? ` (${activeFilters})` : ''}
        </button>
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

      <div className={styles.filterPanel}>
          {categories.length > 0 && (
            <div className={styles.selectWrap}>
              <select
                className={styles.select}
                value={category}
                onChange={(e) => onCategoryChange(e.target.value)}
                aria-label="Category filter"
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <Icon name="expand_more" size={18} style={{ color: 'var(--outline)' }} />
            </div>
          )}

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
        </div>
    </div>
  );
});
