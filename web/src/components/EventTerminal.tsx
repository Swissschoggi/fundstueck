import { useEffect, useRef, useState } from 'react';
import type { ServerEvent } from '../lib/types';
import { Icon } from './Icon';
import styles from './Settings.module.css';

function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '--:--:--'
    : d.toLocaleTimeString('de-CH', { hour12: false });
}

export function EventTerminal({ events }: { events: ServerEvent[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!collapsed && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [events, collapsed]);

  return (
    <section className={styles.terminal}>
      <div className={styles.terminalBar}>
        <div className={styles.terminalBarLeft}>
          <div className={styles.terminalDots}>
            <span />
            <span />
            <span />
          </div>
          <div className={styles.terminalDivider} />
          <Icon name="terminal" size={15} style={{ color: 'var(--on-surface-variant)' }} />
          <span className={styles.terminalTitle}>Server event stream</span>
          <span className={styles.terminalBadge}>
            <span className={styles.terminalPulse} />
            REAL EVENTS · POLL 5S
          </span>
        </div>
        <button
          type="button"
          className={styles.terminalToggle}
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Expand event stream' : 'Collapse event stream'}
        >
          <Icon name={collapsed ? 'expand_more' : 'expand_less'} size={17} />
        </button>
      </div>

      {!collapsed && (
        <div className={styles.terminalBody} ref={bodyRef}>
          {events.length === 0 ? (
            <div className={styles.terminalEmpty}>
              // No events yet. Run a search or a health check to generate entries.
            </div>
          ) : (
            events.map((e) => (
              <div
                key={e.id}
                className={`${styles.terminalLine} ${
                  e.level === 'error'
                    ? styles.lineError
                    : e.level === 'ok'
                      ? styles.lineOk
                      : ''
                }`}
              >
                <span className={styles.lineTime}>[{clock(e.at)}]</span>
                <span className={styles.lineSource}>[{e.source}]</span>
                <span className={styles.lineMessage}>{e.message}</span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
