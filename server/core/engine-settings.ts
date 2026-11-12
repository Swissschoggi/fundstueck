import type { ServerConfig } from '../config.js';
import { readState, writeState } from './storage.js';

/**
 * Operator-tunable matching engine settings. These control how aggressively
 * cross-marketplace duplicates are merged. Defaults preserve the original
 * behaviour; everything is clamped to a safe range.
 */
export interface EngineSettings {
  /** Minimum title token similarity (Jaccard) to consider two listings equal. */
  titleThreshold: number;
  /** Allow a title+price match when asking prices differ by up to this percent. */
  priceAllowancePct: number;
  /** Treat identical product image URLs as the same item. */
  imageMatch: boolean;
  updatedAt: string;
}

const DEFAULTS: EngineSettings = {
  titleThreshold: 0.8,
  priceAllowancePct: 10,
  imageMatch: true,
  updatedAt: '',
};

let current: EngineSettings = { ...DEFAULTS };

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalize(input: Partial<EngineSettings>): EngineSettings {
  return {
    titleThreshold: clamp(Number(input.titleThreshold ?? DEFAULTS.titleThreshold), 0.5, 0.95, DEFAULTS.titleThreshold),
    priceAllowancePct: clamp(Number(input.priceAllowancePct ?? DEFAULTS.priceAllowancePct), 0, 30, DEFAULTS.priceAllowancePct),
    imageMatch: input.imageMatch ?? DEFAULTS.imageMatch,
    updatedAt: new Date().toISOString(),
  };
}

export async function initEngineSettings(_cfg: ServerConfig): Promise<void> {
  const parsed = await readState<Partial<EngineSettings>>('engine-settings');
  current = parsed ? normalize(parsed) : { ...DEFAULTS };
}

/** Synchronous snapshot for the hot matching path. */
export function getEngineSettings(): EngineSettings {
  return current;
}

export async function setEngineSettings(patch: Partial<EngineSettings>): Promise<EngineSettings> {
  current = normalize({ ...current, ...patch });
  await writeState('engine-settings', current);
  return current;
}
