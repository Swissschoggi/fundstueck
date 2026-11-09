import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import styles from './DealRadarPage.module.css';

export function DealRadarPage() {
  const [deals, setDeals] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/deals')
      .then((r) => r.json())
      .then((d) => setDeals(d.deals ?? []))
      .catch(() => setDeals([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Deal Radar</h1>
        <p className={styles.sub}>Price drops detected across marketplaces.</p>
      </header>
      {loading && <p className={styles.empty}>Loading…</p>}
      {!loading && deals.length === 0 && (
        <div className={styles.empty}>
          <Icon name="trending_down" size={32} />
          <p>No deals detected yet. Search for items to start tracking prices.</p>
        </div>
      )}
      <div className={styles.list}>
        {deals.map((d) => (
          <div key={String(d.id)} className={styles.card}>
            <div className={styles.head}>
              <span className={styles.source}>{String(d.source ?? '')}</span>
              <span className={styles.drop}>-{Number(d.drop_pct ?? 0).toFixed(1)}%</span>
            </div>
            <h3 className={styles.cardTitle}>{String(d.title)}</h3>
            <div className={styles.prices}>
              <span className={styles.old}>{String(d.old_price ?? '')} {String(d.currency ?? '')}</span>
              <span className={styles.new}>{String(d.new_price ?? '')} {String(d.currency ?? '')}</span>
            </div>
            <a href={String(d.listing_url ?? '#')} target="_blank" rel="noreferrer" className={styles.link}>
              Open listing →
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}