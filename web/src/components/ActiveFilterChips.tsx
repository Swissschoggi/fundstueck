import { Icon } from './Icon';
import styles from './ActiveFilterChips.module.css';

export interface ActiveFilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

/**
 * A single, always-visible row of active-filter chips shared by desktop and
 * mobile. Previously the only way to see which filters were active was to
 * reopen each individual control, and "Reset" lived inside the desktop
 * filter rail only — invisible on mobile and easy to miss on desktop.
 */
export function ActiveFilterChips({
  chips,
  onClearAll,
}: {
  chips: ActiveFilterChip[];
  onClearAll: () => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div className={styles.row} role="group" aria-label="Active filters">
      {chips.map((chip) => (
        <button key={chip.key} type="button" className={styles.chip} onClick={chip.onRemove}>
          <span>{chip.label}</span>
          <Icon name="close" size={14} />
        </button>
      ))}
      {chips.length > 1 && (
        <button type="button" className={styles.clearAll} onClick={onClearAll}>
          Clear all
        </button>
      )}
    </div>
  );
}
