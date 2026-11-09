import type { SourceStatus } from '../lib/types';
import { sourceAccent } from '../lib/format';
import styles from './SourcePills.module.css';

export function SourcePills({
  sources,
  counts,
  active,
  onChange,
}: {
  sources: SourceStatus[];
  counts: Record<string, number> | null;
  active: string;
  onChange: (source: string) => void;
}) {
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : null;
  return (
    <div className={styles.row} role="group" aria-label="Filter by source">
      <button
        type="button"
        className={`${styles.pill} ${active === 'all' ? styles.pillActive : ''}`}
        onClick={() => onChange('all')}
      >
        <span>All sources</span>
        {counts && <span className={styles.count}>{total}</span>}
      </button>
      {sources.map((s) => (
        <button
          key={s.source}
          type="button"
          className={`${styles.pill} ${active === s.source ? styles.pillActive : ''}`}
          onClick={() => onChange(s.source)}
          title={s.disabledReason ?? s.label}
        >
          <span className={styles.dot} style={{ background: sourceAccent(s.source) }} />
          <span>{s.label}</span>
          {counts && <span className={styles.countDim}>{counts[s.source] ?? 0}</span>}
        </button>
      ))}
    </div>
  );
}
