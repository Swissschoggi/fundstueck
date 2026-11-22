export interface NavItem {
  id: string;
  label: string;
  icon: string;
  path: string;
  soon?: boolean;
}

export const PRIMARY_NAV: NavItem[] = [
  { id: 'search', label: 'Search', icon: 'search', path: '/' },
  { id: 'saved', label: 'Saved items', icon: 'bookmark', path: '/saved' },
  { id: 'deals', label: 'Deal radar', icon: 'monitoring', path: '/deals' },
  { id: 'alerts', label: 'Alerts', icon: 'notifications', path: '/alerts' },
];

// A single mobile tab for both operator-level areas (adapter health and
// custom source plugins). Each got its own top-level tab before, which left
// only 4 tabs' worth of room for Search/Saved/Deal Radar/Alerts on a bar
// that's already tight on a phone, and gave two settings-ish destinations
// equal billing with the app's actual daily-use sections. Source plugins is
// still one tap away from the Settings page itself (see SettingsPage).
export const SETTINGS_NAV: NavItem[] = [
  { id: 'settings', label: 'Settings', icon: 'settings', path: '/settings/adapters' },
];
