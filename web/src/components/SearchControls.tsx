import { forwardRef, useEffect, useState } from 'react';
import type { CategoryOption, SortKey, ViewMode } from '../lib/types';
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
    sort: SortKey;
    onSortChange: (s: SortKey) => void;
    category: string;
    categories: CategoryOption[];
    onCategoryChange: (c: string) => void;
    view: ViewMode;
    onViewChange: (v: ViewMode) => void;
    isSearching: boolean;
    sourceFilter?: string;
    onSourceFilterChange?: (s: string) => void;
    sources?: { source: string; label: string; enabled: boolean }[];
    minPrice?: string;
    maxPrice?: string;
    onPriceChange?: (min: string, max: string) => void;
    currency?: string;
    gender?: string;
    onGenderChange?: (g: string) => void;
    size?: string;
    onSizeChange?: (s: string) => void;
  }
>(function SearchControls(
  {
    input,
    onInputChange,
    onSubmit,
    onClear,
    sort,
    onSortChange,
    category,
    categories,
    onCategoryChange,
    view,
    onViewChange,
    isSearching,
    sourceFilter,
    onSourceFilterChange,
    sources,
    minPrice,
    maxPrice,
    onPriceChange,
    currency,
    gender,
    onGenderChange,
    size,
    onSizeChange,
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
  const activeFilters =
    (category ? 1 : 0) +
    (sort !== 'best' ? 1 : 0) +
    (minPrice || maxPrice ? 1 : 0) +
    (gender ? 1 : 0) +
    (size ? 1 : 0) +
    (sourceFilter && sourceFilter !== 'all' ? 1 : 0);
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
          aria-expanded={filtersOpen}
          aria-controls="search-filter-panel"
        >
          <Icon name="tune" size={16} />
          Filters{activeFilters > 0 ? ` (${activeFilters})` : ''}
        </button>
        <div className={styles.viewToggle} role="group" aria-label="Result view">
          <button
            type="button"
            className={`${styles.viewBtn} ${view === 'grid' ? styles.viewActive : ''}`}
            title="Grid view"
            aria-label="Grid view"
            aria-pressed={view === 'grid'}
            onClick={() => onViewChange('grid')}
          >
            <Icon name="grid_view" size={18} />
          </button>
          <button
            type="button"
            className={`${styles.viewBtn} ${view === 'list' ? styles.viewActive : ''}`}
            title="List view"
            aria-label="List view"
            aria-pressed={view === 'list'}
            onClick={() => onViewChange('list')}
          >
            <Icon name="view_agenda" size={18} />
          </button>
        </div>
      </div>

      <div id="search-filter-panel" className={`${styles.filterPanel} ${filtersOpen ? styles.filterPanelOpen : ''}`}>
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

          <form
            className={styles.mobileFilterGroup}
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              onPriceChange?.(String(fd.get('min') ?? ''), String(fd.get('max') ?? ''));
            }}
          >
            <label htmlFor="mobile-price-min" className={styles.mobileFilterLabel}>Price ({currency || 'CHF'})</label>
            <div className={styles.mobilePriceRow}>
              <input
                id="mobile-price-min"
                name="min"
                type="number"
                min="0"
                placeholder="Min"
                defaultValue={minPrice || ''}
                className={styles.mobileInput}
                aria-label="Minimum price"
              />
              <span className={styles.mobilePriceSep}>–</span>
              <input
                id="mobile-price-max"
                name="max"
                type="number"
                min="0"
                placeholder="Max"
                defaultValue={maxPrice || ''}
                className={styles.mobileInput}
                aria-label="Maximum price"
              />
              <button type="submit" className={styles.mobileApply}>Apply</button>
            </div>
          </form>

          <div className={styles.mobileFilterGroup}>
            <label className={styles.mobileFilterLabel}>Gender (inferred)</label>
            <div className={styles.mobileSeg}>
              {['all', 'male', 'female', 'unisex'].map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`${styles.mobileSegBtn} ${(gender || 'all') === g ? styles.mobileSegActive : ''}`}
                  onClick={() => onGenderChange?.(g === 'all' ? '' : g)}
                >
                  {g === 'all' ? 'All' : g.charAt(0).toUpperCase() + g.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.mobileFilterGroup}>
            <label htmlFor="mobile-size" className={styles.mobileFilterLabel}>Size (inferred)</label>
            <input
              id="mobile-size"
              type="text"
              className={styles.mobileInput}
              placeholder="e.g. 42, M, XL"
              value={size || ''}
              onChange={(e) => onSizeChange?.(e.target.value)}
              aria-label="Size filter"
            />
          </div>

          {sources && sources.length > 0 && (
            <div className={styles.sourceFilterRow}>
              <button
                type="button"
                className={`${styles.sourceFilterBtn} ${!sourceFilter || sourceFilter === 'all' ? styles.sourceFilterActive : ''}`}
                onClick={() => onSourceFilterChange?.('all')}
              >
                All
              </button>
              {sources.filter((s) => s.enabled).map((s) => (
                <button
                  key={s.source}
                  type="button"
                  className={`${styles.sourceFilterBtn} ${sourceFilter === s.source ? styles.sourceFilterActive : ''}`}
                  onClick={() => onSourceFilterChange?.(s.source)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}        </div>
    </div>
  );
});
