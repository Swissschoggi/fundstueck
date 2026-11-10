import { Icon } from './Icon';
import { PRIMARY_NAV, SETTINGS_NAV } from '../lib/navigation';
import styles from './MobileBottomNav.module.css';

export function MobileBottomNav({
  active,
  onNavigate,
  savedCount = 0,
}: {
  active: string;
  onNavigate: (to: string) => void;
  savedCount?: number;
}) {
  const tabs = [
    ...PRIMARY_NAV.filter((item) => !item.soon).map((item) => ({ ...item, badge: item.id === 'saved' ? savedCount : undefined })),
    ...SETTINGS_NAV.map((item) => ({ ...item, badge: undefined })),
  ];

  return (
    <nav className={styles.bar} aria-label="Primary">
      {tabs.map((t) => {
        const isActive =
          active === t.id ||
          active === t.path ||
          (t.id === 'sources' && active.startsWith('/settings/sources')) ||
          (t.id === 'settings' &&
            active.startsWith('/settings') &&
            !active.startsWith('/settings/sources'));
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
            </span>
            <span className={styles.label}>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
