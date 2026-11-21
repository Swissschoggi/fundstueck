import { useCallback, useEffect, useState } from 'react';
import type { DealRecord } from '../lib/types';
import { formatChf, timeAgo } from '../lib/format';
import { Icon } from './Icon';
import styles from './DealRadarPage.module.css';

type Status = 'loading' | 'success' | 'error';

export function DealRadarPage() {
  const [deals, setDeals] = useState<DealRecord[]>([]);
  const [status, setStatus] = useState<Status>('loading');

  const load = useCallback(() => {
    setStatus('loading');
    fetch('/api/deals')
      .then((r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`);
        return r.json();
      })
      .then((d) => {
        setDeals(Array.isArray(d?.deals) ? d.deals : []);
        setStatus('success');
      })
      .catch(() => {
        setDeals([]);
        setStatus('error');
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Deal Radar</h1>
        <p className={styles.sub}>
          Price drops on listings your searches have seen before. These are asking-price changes
          observed by Fundstück over time, not verified market value or sale prices.
        </p>
      </header>

      {status === 'loading' && (
        <div className={styles.empty} role="status" aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <p>Loading price history…</p>
        </div>
      )}

      {status === 'error' && (
        <div className={styles.empty} role="alert">
          <Icon name="error" size={32} style={{ color: 'var(--error, #f87171)' }} />
          <p>Could not load Deal Radar right now.</p>
          <button type="button" className={styles.retry} onClick={load}>
            Try again
          </button>
        </div>
      )}

      {status === 'success' && deals.length === 0 && (
        <div className={styles.empty}>
          <Icon name="trending_down" size={32} />
          <p>No price drops detected yet.</p>
          <p className={styles.emptyHint}>
            Deal Radar watches prices on listings that turn up in your searches. Search for
            something you're tracking, and come back later to see if its price has moved.
          </p>
        </div>
      )}

      {status === 'success' && deals.length > 0 && (
        <div className={styles.list}>
          {deals.map((d) => (
            <div key={`${d.source}:${d.listing_id}`} className={styles.card}>
              <div className={styles.head}>
                <span className={styles.source}>{d.source}</span>
                <span className={styles.drop}>
                  <Icon name="trending_down" size={14} /> -{d.drop_pct.toFixed(1)}%
                </span>
              </div>
              <h3 className={styles.cardTitle}>{d.title}</h3>
              <div className={styles.prices}>
                <span className={styles.old}>{formatChf(d.old_price, d.currency)}</span>
                <span className={styles.new}>{formatChf(d.new_price, d.currency)}</span>
                <span className={styles.detected}>· {timeAgo(d.detected_at)}</span>
              </div>
              {d.listing_url ? (
                <a href={d.listing_url} target="_blank" rel="noreferrer" className={styles.link}>
                  Open listing <Icon name="north_east" size={12} />
                </a>
              ) : (
                <span className={styles.linkDisabled}>Original listing link unavailable</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
