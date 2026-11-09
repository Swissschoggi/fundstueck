/** Swiss typographic currency formatting: CHF 1'250.– / CHF 89.95. */
export function formatChf(value: number, currency = 'CHF'): string {
  const isInt = Number.isInteger(value);
  const fixed = value.toFixed(2);
  const [intPart, fracPart] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '’');
  return `${currency} ${isInt ? `${grouped}.–` : `${grouped}.${fracPart}`}`;
}

/** "just now" / "18 min ago" / "4 hours ago" / "3 days ago". */
export function timeAgo(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

/** Accent colour per marketplace source (design tokens). */
export function sourceAccent(source: string): string {
  switch (source) {
    case 'ricardo':
      return 'var(--accent-ricardo)';
    case 'tutti':
      return 'var(--accent-tutti)';
    case 'anibis':
      return 'var(--accent-anibis)';
    case 'ebay':
      return 'var(--accent-ebay)';
    case 'sample':
      return 'var(--accent-sample)';
    default:
      return 'var(--accent-default)';
  }
}
