import type { SourceInfo } from '../lib/types';
import { sourceAccent } from '../lib/format';
import { Icon } from './Icon';
import styles from './Sidebar.module.css';

const NAV_ITEMS = [
  { id: 'search', label: 'Search', icon: 'search', path: '/' },
  { id: 'saved', label: 'Saved items', icon: 'bookmark', path: '/saved' },
  { id: 'deals', label: 'Deal radar', icon: 'monitoring', path: '/deals' },
  { id: 'alerts', label: 'Alerts', icon: 'notifications', soon: true },
];

const SETTINGS_ITEMS = [
  { id: 'adapters', label: 'Crawlers & Daemons', icon: 'dns', path: '/settings/adapters' },
  { id: 'sources', label: 'Source plugins', icon: 'extension', path: '/settings/sources' },
];

export function Sidebar({
  sources,
  latencyMs,
  isSearching,
  route,
  onNavigate,
}: {
  sources: SourceInfo[];
  latencyMs: number | null;
  isSearching: boolean;
  route: string;
  onNavigate: (to: string) => void;
}) {
  const anyEnabled = sources.some((s) => s.enabled);
  const settingsActive = (path: string) =>
    route === path || (path === '/settings/adapters' && route === '/settings');

  return (
    <aside className={styles.sidebar}>
      <div className={styles.top}>
        <button type="button" className={styles.brand} onClick={() => onNavigate('/')}>
          <div className={styles.brandMark}>
            <Icon name="radar" size={17} />
          </div>
          <div className={styles.brandText}>
            <span className={styles.brandName}>Fundstück</span>
            <span className={styles.brandSub}>Meta-Search</span>
          </div>
        </button>

        <button
          type="button"
          className={`${styles.mobileSettings} ${
            route.startsWith('/settings/sources') ? styles.active : ''
          }`}
          aria-label="Source plugins"
          aria-current={route.startsWith('/settings/sources') ? 'page' : undefined}
          onClick={() => onNavigate('/settings/sources')}
        >
          <Icon name="extension" size={18} />
        </button>

        <button
          type="button"
          className={`${styles.mobileSettings} ${
            route.startsWith('/settings') && !route.startsWith('/settings/sources')
              ? styles.active
              : ''
          }`}
          aria-label="Crawlers & Daemons settings"
          aria-current={
            route.startsWith('/settings') && !route.startsWith('/settings/sources')
              ? 'page'
              : undefined
          }
          onClick={() => onNavigate(SETTINGS_ITEMS[0].path)}
        >
          <Icon name="settings" size={18} />
        </button>

        <div className={styles.syncPill}>
          <span className={styles.syncLeft}>
            <span
              className={`${styles.dot} ${isSearching || anyEnabled ? styles.live : ''}`}
            />
            {isSearching ? 'Searching…' : anyEnabled ? 'Ready' : 'No sources'}
          </span>
          <span className={styles.latency}>{latencyMs != null ? `${latencyMs}ms` : '—'}</span>
        </div>

        <nav className={styles.nav} aria-label="Main navigation">
          {NAV_ITEMS.map((item) =>
            item.soon ? (
              <button
                key={item.id}
                type="button"
                className={`${styles.navItem} ${styles.disabled}`}
                title={`${item.label} — planned feature`}
                aria-disabled
              >
                <Icon name={item.icon} size={18} />
                <span>{item.label}</span>
                <span className={styles.soon}>soon</span>
              </button>
            ) : (
              <button
                key={item.id}
                type="button"
                className={`${styles.navItem} ${route === item.path ? styles.active : ''}`}
                aria-current={route === item.path ? 'page' : undefined}
                onClick={() => {
                  if (item.path) onNavigate(item.path);
                }}
              >
                <Icon name={item.icon} size={18} />
                <span>{item.label}</span>
              </button>
            ),
          )}

          <div className={styles.navDivider} />

          {SETTINGS_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`${styles.navItem} ${settingsActive(item.path) ? styles.active : ''}`}
              aria-current={settingsActive(item.path) ? 'page' : undefined}
              onClick={() => onNavigate(item.path)}
            >
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className={styles.bottom}>
        <div className={styles.sourcesTitle}>Sources</div>
        {sources.map((s) => (
          <div
            key={s.source}
            className={styles.sourceRow}
            title={s.disabledReason ?? `${s.label} (${s.mode})`}
          >
            <span
              className={styles.sourceDot}
              style={{
                background: s.enabled ? sourceAccent(s.source) : 'var(--outline-variant)',
              }}
            />
            <span>{s.label}</span>
            <span className={styles.sourceState}>
              {s.enabled ? (s.mode === 'sample' ? 'sample' : 'live') : 'off'}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}
