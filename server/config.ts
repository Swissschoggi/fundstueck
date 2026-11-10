import path from 'node:path';
import { DEFAULT_MARKET, findMarket } from './core/markets.js';

/** Configuration for the public-page (scraper) adapters. */
export interface ScraperConfig {
  userAgent: string;
  /** Minimum spacing between outbound requests, per adapter. */
  minIntervalMs: number;
  tutti: boolean;
  anibis: boolean;
  /** Marko.ch public search-page adapter (Switzerland, CHF). */
  marko: boolean;
  /** Mercari Japan adapter. */
  mercari: boolean;
  /** Depop public search-page adapter (GB/US/AU, multi-currency). */
  depop: boolean;
  /** Blocket (Sweden) adapter. */
  blocket: boolean;
  /** Vinted adapter (unofficial, disabled by default). */
  vinted: boolean;
  /** Optional regional public-page adapters (Marktplaats, Subito, …). */
  regional: boolean;
}

/** Central server configuration, read once at boot from process.env. */
export interface ServerConfig {
  port: number;
  nodeEnv: string;
  dataDir: string;
  /** Postgres connection string; when set, all persisted state lives in Postgres. */
  databaseUrl: string | undefined;
  /** Directory scanned for optional source plugins (empty/missing by default). */
  pluginsDir: string;
  /** Set ENABLE_PLUGINS=false to ignore PLUGINS_DIR entirely. */
  pluginsEnabled: boolean;
  /** Region chosen during first-run setup, if forced by the environment. */
  region: string | null;
  /** Default buyer market when the request does not specify one. */
  defaultMarket: string;
  /**
   * Bearer token that grants access to operator/admin API routes in
   * production (adapter install, custom sources, catalog installs, setup,
   * config writes). Complements ADMIN_EMAILS.
   */
  operatorToken: string | undefined;
  /**
   * Email addresses (lowercased) whose signed-in sessions may use
   * operator/admin API routes in production.
   */
  adminEmails: string[];
  ebay: {
    clientId: string | undefined;
    clientSecret: string | undefined;
    marketplaceId: string;
    /** api.ebay.com or api.sandbox.ebay.com */
    apiBase: string;
  };
  enableSampleAdapter: boolean;
  scrapers: ScraperConfig;
}

const DEFAULT_SCRAPER_UA =
  'FundstueckBot/0.1 (+https://github.com/Swissschoggi/fundstueck; polite meta-search)';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const useSandbox = env.EBAY_USE_SANDBOX === 'true';
  return {
    port: Number(env.PORT ?? 3001),
    nodeEnv,
    dataDir: env.DATA_DIR ? path.resolve(env.DATA_DIR) : path.resolve(process.cwd(), 'data'),
    databaseUrl: env.DATABASE_URL || undefined,
    pluginsDir: env.PLUGINS_DIR
      ? path.resolve(env.PLUGINS_DIR)
      : path.resolve(process.cwd(), 'plugins'),
    pluginsEnabled: env.ENABLE_PLUGINS !== 'false',
    region: findMarket(env.REGION ?? '')?.code ?? null,
    defaultMarket: findMarket(env.DEFAULT_MARKET ?? '')?.code ?? DEFAULT_MARKET,
    operatorToken: env.OPERATOR_TOKEN || undefined,
    adminEmails: (env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    ebay: {
      clientId: env.EBAY_CLIENT_ID || undefined,
      clientSecret: env.EBAY_CLIENT_SECRET || undefined,
      marketplaceId: env.EBAY_MARKETPLACE_ID || 'EBAY_CH',
      apiBase: useSandbox ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com',
    },
    // Sample data is a dev affordance: on by default outside production,
    // always opt-in in production so we never fabricate listings there.
    enableSampleAdapter:
      env.ENABLE_SAMPLE_ADAPTER != null
        ? env.ENABLE_SAMPLE_ADAPTER === 'true'
        : nodeEnv !== 'production',
    scrapers: {
      userAgent: env.SCRAPER_USER_AGENT || DEFAULT_SCRAPER_UA,
      minIntervalMs: sanitizeInterval(env.SCRAPER_MIN_INTERVAL_MS),
      // Public server-rendered search pages: on by default (rate-limited).
      tutti: env.ENABLE_TUTTI_ADAPTER !== 'false',
      anibis: env.ENABLE_ANIBIS_ADAPTER !== 'false',
      // Marko.ch public search-page adapter (Switzerland, CHF).
      marko: env.ENABLE_MARKO_ADAPTER !== 'false',
      // Mercari Japan (unofficial API).
      mercari: env.ENABLE_MERCARI_ADAPTER !== 'false',
      // Depop public search-page adapter (GB/US/AU). Disabled by default:
      // Depop's robots.txt disallows /search/* for crawlers and its terms
      // prohibit scraping — enable only after reviewing their terms
      // (ENABLE_DEPOP_ADAPTER=true).
      depop: env.ENABLE_DEPOP_ADAPTER === 'true',
      blocket: env.ENABLE_BLOCKET_ADAPTER !== 'false',
      // Vinted (unofficial API). Restricted terms — disabled by default.
      vinted: env.ENABLE_VINTED_ADAPTER === 'true',
      // Regional public search pages (only instantiated for the chosen region).
      regional: env.ENABLE_REGIONAL_ADAPTERS !== 'false',
    },
  };
}

function sanitizeInterval(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1000 ? n : 3000;
}
