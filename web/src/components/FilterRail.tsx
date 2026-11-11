import type { SourceInfo } from '../lib/types';

import { Icon } from './Icon';
import styles from './FilterRail.module.css';


export function FilterRail({
  minPrice,
  maxPrice,
  onPriceChange,
  onReset,
  sources,
  market: _market,
  currency,
  gender,
  onGenderChange,
  size,
  onSizeChange,
  sourceFilter,
  onSourceFilterChange,
  hidePriceless,
  onHidePricelessChange,
}: {
  minPrice: string;
  maxPrice: string;
  onPriceChange: (min: string, max: string) => void;
  onReset: () => void;
  sources: SourceInfo[];
  market: string;
  currency: string;
  gender?: string;
  onGenderChange?: (g: string) => void;
  size?: string;
  onSizeChange?: (s: string) => void;
  sourceFilter?: string;
  onSourceFilterChange?: (s: string) => void;
  hidePriceless?: boolean;
  onHidePricelessChange?: (v: boolean) => void;
}) {
  return (
    <aside className={styles.rail}>
      <div className={styles.card}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <Icon name="tune" size={18} style={{ color: 'var(--primary)' }} />
            <span className={`t-headline-sm ${styles.headerTitle}`}>Filters</span>
          </div>
          <button type="button" className={styles.reset} onClick={onReset}>
            Reset
          </button>
        </div>

        <form
          key={`${minPrice}|${maxPrice}`}
          className={styles.section}
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            onPriceChange(String(form.get('min') ?? ''), String(form.get('max') ?? ''));
          }}
        >
          <div className={styles.sectionHeader}>
            <label className={styles.label}>Price ({currency})</label>
            <span className={`t-code-chf ${styles.rangeValue}`}>
              {minPrice || '0'} – {maxPrice || '∞'}
            </span>
          </div>
          <div className={styles.priceInputs}>
            <div className={styles.priceBox}>
              <span className={styles.priceLabel}>Min</span>
              <input
                name="min"
                type="number"
                min="0"
                inputMode="numeric"
                placeholder="0"
                defaultValue={minPrice}
                className={styles.priceInput}
                aria-label={`Minimum price in ${currency}`}
              />
            </div>
            <div className={styles.priceBox}>
              <span className={styles.priceLabel}>Max</span>
              <input
                name="max"
                type="number"
                min="0"
                inputMode="numeric"
                placeholder="∞"
                defaultValue={maxPrice}
                className={styles.priceInput}
                aria-label={`Maximum price in ${currency}`}
              />
            </div>
          </div>
          <button type="submit" className={styles.apply}>
            Apply price
          </button>
        </form>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <label className={styles.label} id="gender-label">
              Gender
              <span className={styles.inferred}>inferred</span>
            </label>
          </div>
          <div className={styles.segmented} role="group" aria-labelledby="gender-label">
            {['all', 'male', 'female', 'unisex'].map((g) => (
              <button
                key={g}
                type="button"
                className={`${styles.segment} ${(gender || 'all') === g ? styles.segmentActive : ''}`}
                onClick={() => onGenderChange?.(g === 'all' ? '' : g)}
                aria-pressed={(gender || 'all') === g}
              >
                {g === 'all' ? 'All' : g.charAt(0).toUpperCase() + g.slice(1)}
              </button>
            ))}
          </div>
          <p className={styles.hint}>
            Best-effort: derived from listing titles. Most marketplaces do not expose gender.
          </p>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <label className={styles.label} id="size-label">
              Size
              <span className={styles.inferred}>inferred</span>
            </label>
          </div>
          <input
            type="text"
            className={styles.sizeInput}
            placeholder="e.g. 42, M, XL"
            value={size || ''}
            onChange={(e) => onSizeChange?.(e.target.value)}
            aria-labelledby="size-label"
          />
          <p className={styles.hint}>Best-effort: derived from listing titles.</p>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <label className={styles.label}>Priceless listings</label>
          </div>
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={!!hidePriceless}
              onChange={(e) => onHidePricelessChange?.(e.target.checked)}
            />
            Hide listings without a price
          </label>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <label className={styles.label}>Filter by source</label>
          </div>
          <div className={styles.sourceFilterList}>
            <button
              type="button"
              className={`${styles.sourceFilterBtn} ${!sourceFilter || sourceFilter === 'all' ? styles.sourceFilterActive : ''}`}
              onClick={() => onSourceFilterChange?.('all')}
            >
              All sources
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
        </div>
      </div>

      <details className={styles.advanced}>
        <summary className={styles.advancedSummary}>Advanced (sizing guide, tips)</summary>
        <div className={styles.advancedBody}>
          <p className={styles.advancedTitle}>Shoe size conversion</p>
          <table className={styles.sizeTable}>
            <thead><tr><th>EU</th><th>UK</th><th>US (M)</th><th>US (W)</th></tr></thead>
            <tbody>
              <tr><td>38</td><td>5</td><td>6</td><td>7.5</td></tr>
              <tr><td>39</td><td>6</td><td>7</td><td>8.5</td></tr>
              <tr><td>40</td><td>6.5</td><td>7.5</td><td>9</td></tr>
              <tr><td>41</td><td>7</td><td>8</td><td>9.5</td></tr>
              <tr><td>42</td><td>8</td><td>9</td><td>10.5</td></tr>
              <tr><td>43</td><td>9</td><td>10</td><td>11.5</td></tr>
              <tr><td>44</td><td>9.5</td><td>10.5</td><td>12</td></tr>
              <tr><td>45</td><td>10.5</td><td>11.5</td><td>13</td></tr>
            </tbody>
          </table>
          <p className={styles.advancedHint}>
            Tip: use the size filter above (e.g. "42", "M", "XL") — matching is best-effort from listing titles.
          </p>
        </div>
      </details>
    </aside>
  );
}
