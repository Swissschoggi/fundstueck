import fs from 'node:fs';
import path from 'node:path';
import type { ServerConfig } from '../config.js';
import { findMarket } from './markets.js';

/** A source a region can install. */
export interface RegionSource {
  id: string;
  label: string;
  kind: 'live' | 'official' | 'recipe';
  note?: string;
}

export interface RegionPack {
  code: string;
  label: string;
  group: 'Europe' | 'Americas' | 'Oceania';
  currency: string;
  locale: string;
  blurb: string;
  /** Optional caveat, e.g. no dedicated local adapter yet. */
  note?: string;
  sources: RegionSource[];
}

const LIVE = {
  tutti: { id: 'tutti', label: 'Tutti.ch', kind: 'live' },
  anibis: { id: 'anibis', label: 'Anibis.ch', kind: 'live' },
  marktplaats: { id: 'marktplaats', label: 'Marktplaats', kind: 'live' },
  '2dehands': { id: '2dehands', label: '2dehands', kind: 'live' },
  subito: { id: 'subito', label: 'Subito.it', kind: 'live' },
  willhaben: { id: 'willhaben', label: 'Willhaben.at', kind: 'live' },
  kijiji: { id: 'kijiji', label: 'Kijiji.ca', kind: 'live' },
  kleinanzeigen: { id: 'kleinanzeigen', label: 'Kleinanzeigen.de', kind: 'live' },
} as const satisfies Record<string, RegionSource>;

const EBAY: RegionSource = {
  id: 'ebay',
  label: 'eBay',
  kind: 'official',
  note: 'Official Browse API — needs EBAY_CLIENT_ID / EBAY_CLIENT_SECRET',
};

const RICARDO: RegionSource = {
  id: 'ricardo-community',
  label: 'Ricardo.ch community CLI',
  kind: 'recipe',
  note: 'Optional external install from the source catalog; not bundled',
};

function pack(
  code: string,
  group: RegionPack['group'],
  blurb: string,
  sources: RegionSource[],
  note?: string,
): RegionPack {
  const market = findMarket(code);
  if (!market) throw new Error(`Unknown region ${code}`);
  return {
    code,
    label: market.label,
    group,
    currency: market.currency,
    locale: market.locale,
    blurb,
    note,
    sources,
  };
}

/**
 * Region packs. Selecting a region loads only these built-in adapters, so an
 * install in Germany never constructs or queries the Swiss/Italian sources.
 * Recipes are catalog entries the operator may install later.
 */
export const REGION_PACKS: RegionPack[] = [
  pack(
    'CH',
    'Europe',
    'Swiss classifieds: Tutti and Anibis are live out of the box; Ricardo is an optional community CLI.',
    [LIVE.tutti, LIVE.anibis, EBAY, RICARDO],
  ),
  pack(
    'DE',
    'Europe',
    'Germany: Kleinanzeigen is live; eBay is available with API keys.',
    [LIVE.kleinanzeigen, EBAY],
  ),
  pack(
    'AT',
    'Europe',
    'Austria: Willhaben is live; eBay is available with API keys.',
    [LIVE.willhaben, EBAY],
  ),
  pack(
    'IT',
    'Europe',
    'Italy: Subito is live; eBay is available with API keys.',
    [LIVE.subito, EBAY],
  ),
  pack(
    'NL',
    'Europe',
    'Netherlands: Marktplaats is live; eBay is available with API keys.',
    [LIVE.marktplaats, EBAY],
  ),
  pack(
    'BE',
    'Europe',
    'Belgium: 2dehands is live; eBay is available with API keys.',
    [LIVE['2dehands'], EBAY],
  ),
  pack(
    'GB',
    'Europe',
    'United Kingdom: eBay is available with API keys. No dedicated UK public-page adapter is installed.',
    [EBAY],
    'Gumtree public search pages currently serve an anti-bot challenge, so they are not bundled. Add a permitted custom source from Source plugins.',
  ),
  pack(
    'FR',
    'Europe',
    'France: eBay is available with API keys. No dedicated French public-page adapter yet.',
    [EBAY],
    'Add a custom HTTP/CLI source for a local marketplace (e.g. Leboncoin) from Source plugins.',
  ),
  pack(
    'ES',
    'Europe',
    'Spain: eBay is available with API keys. No dedicated Spanish public-page adapter yet.',
    [EBAY],
    'Add a custom HTTP/CLI source for a local marketplace (e.g. Wallapop) from Source plugins.',
  ),
  pack(
    'US',
    'Americas',
    'United States: eBay is available with API keys.',
    [EBAY],
    'Add a custom HTTP/CLI source for a local marketplace from Source plugins.',
  ),
  pack(
    'CA',
    'Americas',
    'Canada: Kijiji is live; eBay is available with API keys.',
    [LIVE.kijiji, EBAY],
  ),
  pack(
    'AU',
    'Oceania',
    'Australia: eBay is available with API keys. No dedicated Australian public-page adapter yet.',
    [EBAY],
    'Add a custom HTTP/CLI source for a local marketplace from Source plugins.',
  ),
];

export function getRegionPack(code: string): RegionPack | undefined {
  return REGION_PACKS.find((p) => p.code === code.toUpperCase());
}

export function installedSourceIds(code: string): string[] {
  const pack = getRegionPack(code);
  return pack
    ? pack.sources.filter((s) => s.kind === 'live' || s.kind === 'official').map((s) => s.id)
    : [];
}

/* ------------------------------------------------------------------ */
/* First-run setup state                                               */
/* ------------------------------------------------------------------ */

interface SetupRecord {
  region: string;
  completedAt: string;
}

export interface SetupState {
  complete: boolean;
  region: string;
}

export function setupFile(cfg: ServerConfig): string {
  return path.join(cfg.dataDir, 'setup.json');
}

export function readSetupRegion(cfg: ServerConfig): string | null {
  try {
    const raw = fs.readFileSync(setupFile(cfg), 'utf8');
    const parsed = JSON.parse(raw) as Partial<SetupRecord>;
    if (typeof parsed.region !== 'string') return null;
    return findMarket(parsed.region)?.code ?? null;
  } catch {
    return null;
  }
}

export function saveSetupRegion(cfg: ServerConfig, region: string): void {
  const market = findMarket(region);
  if (!market) throw new Error(`Unknown region ${region}`);
  const file = setupFile(cfg);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const record: SetupRecord = { region: market.code, completedAt: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
}

function hasExistingInstall(cfg: ServerConfig): boolean {
  return ['adapter-settings.json', 'custom-sources.json'].some((name) =>
    fs.existsSync(path.join(cfg.dataDir, name)),
  );
}

/**
 * Resolve first-run state:
 * - saved setup wins;
 * - an explicit REGION env var counts as setup;
 * - an existing install (adapter/custom-settings file) is upgraded in place;
 * - otherwise the UI must show onboarding.
 */
export function resolveSetup(cfg: ServerConfig): SetupState {
  const saved = readSetupRegion(cfg);
  if (saved) return { complete: true, region: saved };
  if (cfg.region) {
    saveSetupRegion(cfg, cfg.region);
    return { complete: true, region: cfg.region };
  }
  if (hasExistingInstall(cfg)) {
    saveSetupRegion(cfg, cfg.defaultMarket);
    return { complete: true, region: cfg.defaultMarket };
  }
  return { complete: false, region: cfg.defaultMarket };
}
