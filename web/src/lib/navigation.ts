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

export const SETTINGS_NAV: NavItem[] = [
  { id: 'adapters', label: 'Crawlers & Daemons', icon: 'dns', path: '/settings/adapters' },
  { id: 'sources', label: 'Source plugins', icon: 'extension', path: '/settings/sources' },
];
