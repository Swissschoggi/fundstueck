import { Icon } from './Icon';
import styles from './MobileBottomNav.module.css';

export function MobileBottomNav({
  active,
  onNavigate,
  savedCount = 0,
  hasUnread = false,
}: {
  active: string;
  onNavigate: (to: string) => void;
  savedCount?: number;
  hasUnread?: boolean;
}) {
  const tabs = [
    { id: 'search', label: 'Search', icon: 'search', path: '/' },
    { id: 'saved', label: 'Saved', icon: 'bookmark', path: '/saved', badge: savedCount },
    { id: 'alerts', label: 'Alerts', icon: 'notifications', path: '/alerts', dot: hasUnread },
    { id: 'settings', label: 'Settings', icon: 'tune', path: '/settings/adapters' },
  ];

  return (
    <nav className={styles.bar} aria-label="Primary">
      {tabs.map((t) => {
        const isActive = active === t.id || active === t.path;
        return (
          <button
            key={t.id}
            type="button"
            className={`${styles.tab} ${isActive ? styles.active : ''}`}
            onClick={() => onNavigate(t.path)}
            aria-current={isActive ? 'page' : undefined}
          >
            <span className={styles.iconWrap}>
              <Icon name={t.icon} size={22} />
              {t.badge && t.badge > 0 ? <span className={styles.badge}>{t.badge}</span> : null}
              {t.dot ? <span className={styles.dot} /> : null}
            </span>
            <span className={styles.label}>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
