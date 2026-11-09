import type { CSSProperties } from 'react';

/** Ligature icon using the Material Symbols font (as in the design mockup). */
export function Icon({
  name,
  size = 18,
  style,
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      className="material-symbols-outlined"
      style={{ fontSize: size, ...style }}
    >
      {name}
    </span>
  );
}
