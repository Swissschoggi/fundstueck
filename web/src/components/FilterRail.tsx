import type { SourceInfo } from '../lib/types';
import { sourceAccent } from '../lib/format';
import { Icon } from './Icon';
import styles from './FilterRail.module.css';

const CANTONS = ['ZH', 'BE', 'VD', 'GE', 'BS', 'LU', 'SG', '+19'];
const CONDITIONS = ['All', 'New', 'Like new', 'Used'];

export function FilterRail({
  minPrice,
  maxPrice,
  onPriceChange,
  onReset,
  sources,
  market,
  currency,
}: {
  minPrice: string;
  maxPrice: string;
  onPriceChange: (min: string, max: string) => void;
  onReset: () => void;
  sources: SourceInfo[];
  market: string;
  currency: string;
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

        {market === 'CH' && (
          <div className={styles.section} aria-disabled="true">
            <div className={styles.sectionHeader}>
              <label className={styles.label}>
                Canton
                <span className={styles.soon}>soon</span>
              </label>
            </div>
            <div className={styles.chips}>
              {CANTONS.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  className={`${styles.chip} ${i === 0 ? styles.chipDisabled : ''}`}
                  disabled
                  title="Canton filters require a local listing store — planned"
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className={styles.section} aria-disabled="true">
          <div className={styles.sectionHeader}>
            <label className={styles.label}>
              Condition
              <span className={styles.soon}>soon</span>
            </label>
          </div>
          <div className={styles.segmented}>
            {CONDITIONS.map((c, i) => (
              <button
                key={c}
                type="button"
                className={`${styles.segment} ${i === 0 ? styles.segmentActive : ''}`}
                disabled
                title="Condition filters require a local listing store — planned"
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <label className={styles.label}>Sources</label>
          </div>
          <div className={styles.sourceList}>
            {sources.map((s) => (
              <div key={s.source} className={styles.sourceRow}>
                <span
                  className={styles.sourceDot}
                  style={{
                    background: s.enabled ? sourceAccent(s.source) : 'var(--outline-variant)',
                  }}
                />
                <div className={styles.sourceMeta}>
                  <span className={styles.sourceName}>
                    {s.label}
                    {s.mode === 'sample' && <span className={styles.soon}>sample</span>}
                  </span>
                  <span className={styles.sourceHint}>
                    {s.enabled ? 'Enabled' : (s.disabledReason ?? 'Disabled')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
