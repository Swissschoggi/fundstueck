# Fundstück

Second-hand marketplace **meta-search** with region-aware source installation.
One query fans out to marketplace sources, results are normalized into a single
feed, and every card links back to the original listing. Fundstück does not host listings, process transactions, or
facilitate seller contact.

Built from the design references in this repo:

- `helvetia_pure_modern/DESIGN.md` — design system ("Helvetia Pure Modern")
- `explore_unified_search_modernized/code.html` + `screen.png` — search UI mockup
- `swisshunt_product_requirements_document_prd.md` — product context

## Quick start (no credentials needed)

```bash
npm install
npm run dev
```

Open http://localhost:5173. On first run, choose your region: Fundstück installs
only that region's built-in sources (for example Switzerland: Tutti + Anibis).
Existing installs with saved adapter settings are treated as already set up and
default to `DEFAULT_MARKET`. Then search for `ThinkPad`.

`npm run dev` starts:

- the search API on http://localhost:3001 (TypeScript via `tsx watch`)
- the Vite frontend on http://localhost:5173 (proxies `/api` to the API)

Out of the box the **sample adapter** is enabled: a curated, deterministic dataset
of representative Swiss classifieds. Sample results are always labelled
(`Sample (dev)` chip + banner) and link to the real marketplace's search page —
they are never presented as live listings.

## Live data sources

### eBay Switzerland — official Browse API

**eBay Switzerland** via eBay's official
[Browse API](https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search)
(public listings, application OAuth token, no scraping, no anti-bot bypass).

1. Create a free account at https://developer.ebay.com and add an application
   keyset (production, for `api.ebay.com`).
2. Copy the Client ID / Client Secret.
3. Create `.env` from `.env.example` and fill in:

```bash
cp .env.example .env
# EBAY_CLIENT_ID=...
# EBAY_CLIENT_SECRET=...
# EBAY_MARKETPLACE_ID=EBAY_CH   # eBay Switzerland, CHF prices
```

Restart `npm run dev`. The eBay adapter is enabled automatically when both
credentials are present; otherwise it is shown as disabled with the reason.
Use `EBAY_USE_SANDBOX=true` to test against `api.sandbox.ebay.com`.

### Tutti.ch, Anibis.ch & Marko.ch — public search pages (on by default)

Both run the same SMG Next.js platform and server-render search results into
`__NEXT_DATA__` when the query is passed as `?query=…`:

- Tutti: `https://www.tutti.ch/de/q?query=velo` (German)
- Anibis: `https://www.anibis.ch/fr/q?query=velo` (French/Romandie)

The adapters read only that public page — never `/api/…` (disallowed by
`robots.txt`), never login-gated data, never the `/li/` routes. Requests are
rate-limited (`SCRAPER_MIN_INTERVAL_MS`, default 3 s) with jitter, use an
identifying `User-Agent`, and responses are cached for 60 s. Titles, prices,
canton/postcode, images, descriptions and publish times are normalised.

They are enabled by default; set `ENABLE_TUTTI_ADAPTER=false` /
`ENABLE_ANIBIS_ADAPTER=false` / `ENABLE_MARKO_ADAPTER=false` to turn them off.
Review each marketplace's terms before commercial deployment — you are
responsible for how your instance uses their pages.

**Marko.ch** is a Swiss Gen-Z second-hand marketplace (CHF). The adapter reads
the public, server-rendered category pages filtered by the query (`/en/c/…?q=…`)
and normalises the embedded listing cards. Marko's `/search` page itself is a
LiveView app that only renders shimmer placeholders server-side, so the adapter
uses the category pages, which are server-rendered and allowed by Marko's
`robots.txt` (`Content-Signal: search=yes`, `/*/c/` allowed). Only the first
page (up to ~72 listings per top-level category: fashion, electronics, home) is
fetched per search.

### Regional public search pages (installed per region)

These adapters are only instantiated for the region chosen during onboarding,
so an install in Germany never constructs or queries the Swiss/Italian sources:

| Region | Adapter | Source |
| --- | --- | --- |
| NL | `marktplaats` | Marktplaats public search page |
| BE | `2dehands` | 2dehands public search page |
| DE | `kleinanzeigen` | Kleinanzeigen.de public search page |
| AT | `willhaben` | Willhaben.at public search page |
| IT | `subito` | Subito.it public search page |
| CA | `kijiji` | Kijiji.ca public search page |

They read only public, server-rendered search pages, are rate-limited with the
same `SCRAPER_*` settings, and are cached for 60 s. Set
`ENABLE_REGIONAL_ADAPTERS=false` to disable all of them. The UK Gumtree and
French / Spanish / Australian sites currently either serve anti-bot challenges or
an inaccessible API, so they are not bundled; those regions start with eBay
(official API) and can add permitted custom sources.

### Mercari (JP) and Blocket (SE)

Both are enabled by default and require no credentials:

- `mercari` — Mercari Japan via the unofficial `mercapi` client (JPY).
- `blocket` — Blocket Sweden via the `blocket-api` Python library (SEK).

Set `ENABLE_MERCARI_ADAPTER=false` or `ENABLE_BLOCKET_ADAPTER=false` to disable.

### Ricardo.ch — community CLI recipe only

There is **no built-in Ricardo adapter**. Ricardo answers non-browser clients
with a CAPTCHA interstitial and offers no self-serve public API, so a direct
adapter always failed. Instead, `/settings/sources` offers one optional catalog
recipe for the external
[`ricardo-scraper`](https://github.com/danyk20/ricardo-scraper) CLI:

```bash
pip install ricardo-scraper   # Python 3.11/3.12
```

Press **Use template** to prefill an external-command source (`--no-detail`
summary mode), then install it. Before the executable exists, the adapter is
shown as **unavailable — executable not found** rather than pretending to work.
The CLI is not downloaded or bundled by Fundstück; it drives fingerprint-patched
Firefox (camoufox) to satisfy Cloudflare, so review Ricardo's and Cloudflare's
terms before enabling it. Fundstück itself never solves a CAPTCHA.

Camoufox (the patched Firefox build this CLI drives) is a real browser and
needs the same OS-level libraries and sandbox permissions any headless
Firefox does. The official Docker image already handles both: it installs
Firefox's runtime shared libraries (`libgtk-3-0`, `libasound2`, `libnss3`,
...) and sets `MOZ_DISABLE_CONTENT_SANDBOX=1`, because Docker's default
seccomp profile blocks the syscall Firefox's own sandbox self-test needs
(`clone(CLONE_NEWUSER)`), which otherwise fails with
`CanCreateUserNamespace() clone() failure: EPERM` on first launch. If you're
installing `scripts/install-ricardo.sh` outside that image (bare metal or a
different base image), it now runs `playwright install-deps firefox`
automatically when possible, and warns in the install log — instead of
failing silently — if it can't. A failed warmup search no longer passes
silently either: check the install log for a "Ricardo warmup search failed"
warning if the source still won't return results after installing.

If a source fails mid-search (auth error, CAPTCHA, upstream timeout, rate
limit), the search still returns results from the other sources and the failing
source is reported in the response and shown as degraded in the UI.

### Depop — community source (opt-in, disabled by default)

Depop's search page is served server-side, but it sits behind a Cloudflare
managed challenge that blocks non-browser clients, and Depop's `robots.txt`
disallows `/search/*` for crawlers while its terms prohibit scraping. For those
reasons there is **no built-in Depop adapter enabled by default**. The codebase
ships a best-effort `DepopAdapter` (curl transport, `ENABLE_DEPOP_ADAPTER=true`)
that may work from some networks but is not guaranteed; for production use,
prefer an external community scraper wired in as a custom command source (see
`/settings/sources` → **External command**), and review Depop's terms first.

### Optional sources — plugins & custom adapters

Fundstück ships **no optional source code**. Everything beyond the built-ins is
installed by the operator, so the base app stays small and auditable. Two
mechanisms are available on **`/settings/sources`**:

1. **Custom sources** — persisted in `data/custom-sources.json` and editable in
   the UI:
   - **HTTP JSON**: point at any search endpoint (`{query}`, `{limit}`,
     `{market}` placeholders), map response fields with dot paths, optionally
     authenticate with a bearer token read from an environment variable.
   - **External command**: spawn a CLI directly (no shell) with argument
     placeholders, optional working directory, timeout, output file and JSON
     parsing. The CLI is never bundled or downloaded by Fundstück.
2. **Plugins** — drop a folder with `plugin.json` + an ESM module into
   `PLUGINS_DIR` (`./plugins` by default, git-ignored), then press **Reload
   plugins**. A plugin exports `createAdapters(ctx)` returning one or more
   `MarketplaceAdapter`s and runs in-process. Broken plugins are isolated and
   shown with their error. See `plugins.example/` for a working template.

The catalog includes a **Ricardo.ch community recipe** that wires the external
[`ricardo-scraper`](https://github.com/danyk20/ricardo-scraper) CLI into the
command adapter (`pip install ricardo-scraper`, summary mode). That project
drives fingerprint-patched Firefox (camoufox) to satisfy Ricardo's Cloudflare
challenge; it is not installed, downloaded or executed by Fundstück until you
install it and save the source yourself. Review Ricardo's and Cloudflare's
terms before enabling it. There is no built-in Ricardo adapter anymore, so the
app itself never attempts to solve a CAPTCHA.

## Buyer markets

Every search is scoped to a buyer market (`CH`, `US`, `GB`, `DE`, `AT`, `FR`,
`IT`, `ES`, `NL`, `BE`, `CA`, `AU`). Onboarding installs the chosen region's
built-in sources; the market picker only offers markets that have installed
sources. The choice is stored in the URL (`?market=US`) so searches stay
shareable.

- First run: region onboarding installs only that region's adapters and sets it
  as the default market. Change it later on `/settings/sources` → **Region**.
- For automated installs, set `REGION=DE` (or another market code) to skip
  onboarding; `DEFAULT_MARKET` remains the fallback.
- Initial market: URL → saved region → `DEFAULT_MARKET`. It is never forced by IP.
- `GET /api/markets` reports each market's currency, locale, eBay marketplace id,
  installed region, setup state and how many sources are available/enabled.
- Adapters declare the markets they serve (`markets` field); searches only fan
  out to adapters covering the active market. `GET /api/sources?market=US`
  returns just that market's adapters.
- A market with no configured sources returns HTTP 503 `NO_SOURCES` with a
  clear message instead of querying unrelated marketplaces.

Installed live sources by region: CH (Tutti, Anibis, Marko), NL (Marktplaats), BE
(2dehands), DE (Kleinanzeigen), AT (Willhaben), IT (Subito), CA (Kijiji). eBay
works in every market once `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` are set — its
marketplace follows the buyer market; `EBAY_MARKETPLACE_ID` is only the fallback.
FR, ES, GB, US and AU currently rely on eBay plus custom sources.

## Database (Postgres)

Fundstück can store all mutable state in Postgres. Set `DATABASE_URL` and the
server creates the `fundstueck_state` table on boot; otherwise it falls back to
JSON files in `DATA_DIR`. A ready-to-use `docker-compose.yml` (app + Postgres)
is included.

## Auth, Favorites, Saved, and Deal Radar

These features use the app's own storage (Postgres when `DATABASE_URL` is set,
otherwise JSON files in `DATA_DIR`). No Supabase is required.
- **Auth**: email/password accounts stored in the app database.
- **Favorites/Saved**: per-user saved listings.
- **Deal Radar**: price history and detected drops stored in the app database.

- **Auth**: email/password sign-in via Supabase Auth.
- **Favorites/Saved**: heart a listing to store it in `fundstueck_favorites`;
  the Saved page lists them.
- **Deal Radar**: `recordPrices` stores price history in
  `fundstueck_price_history` and inserts drops into `fundstueck_deals`.

If the Supabase env vars are unset, these features are disabled gracefully.

## Production

```bash
npm run build   # builds the frontend into web/dist
npm start       # NODE_ENV=production, serves API + web/dist on :3001
```

In production the sample adapter is **disabled by default** so no fabricated
listings are ever served; regional public-page adapters remain enabled for the
chosen region. The first production request shows region onboarding unless
`REGION` is set or an existing install is detected. If
every source is disabled/unconfigured, `/api/search` returns HTTP 503
`NO_SOURCES` with an explanatory message. Set `ENABLE_SAMPLE_ADAPTER=true` to
demo sample data in production builds (results remain clearly labelled).

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | API/static server port |
| `DEFAULT_MARKET` | `CH` | Fallback buyer market before onboarding |
| `REGION` | — | First-run region (`CH`, `DE`, …); set it to skip onboarding |
| `EBAY_CLIENT_ID` | — | eBay application Client ID |
| `EBAY_CLIENT_SECRET` | — | eBay application Client Secret |
| `EBAY_MARKETPLACE_ID` | `EBAY_CH` | eBay marketplace context |
| `EBAY_USE_SANDBOX` | `false` | Use eBay Sandbox (`api.sandbox.ebay.com`) |
| `ENABLE_SAMPLE_ADAPTER` | enabled outside production | Sample data adapter |
| `ENABLE_TUTTI_ADAPTER` | `true` | Tutti public search-page adapter |
| `ENABLE_ANIBIS_ADAPTER` | `true` | Anibis public search-page adapter |
| `ENABLE_MARKO_ADAPTER` | `true` | Marko.ch public search-page adapter |
| `ENABLE_DEPOP_ADAPTER` | `false` | Depop public search-page adapter (opt-in; robots.txt disallows /search/*) |
| `ENABLE_REGIONAL_ADAPTERS` | `true` | Marktplaats, 2dehands, Kleinanzeigen, Willhaben, Subito, Kijiji |
| `ENABLE_MERCARI_ADAPTER` | `true` | Mercari Japan |
| `ENABLE_BLOCKET_ADAPTER` | `true` | Blocket Sweden |
| `SCRAPER_MIN_INTERVAL_MS` | `3000` | Min spacing between requests per adapter |
| `SCRAPER_USER_AGENT` | `FundstueckBot/0.1 (…)` | Identifying UA for public-page requests |
| `DATA_DIR` | `./data` | Persisted runtime toggles, `setup.json` + `custom-sources.json` (file mode) |
| `DATABASE_URL` | — | Postgres connection string; when set, all persisted state lives in Postgres |
| `PLUGINS_DIR` | `./plugins` | Optional source-plugin directory (empty by default) |
| `ENABLE_PLUGINS` | `true` | Set `false` to ignore `PLUGINS_DIR` |
| `API_PROXY_TARGET` | `http://localhost:3001` | Vite dev proxy target |

Secrets live only in `.env` (git-ignored). Never commit credentials.
The chosen region is persisted to `data/setup.json`; runtime adapter
enable/disable choices go to `data/adapter-settings.json`; custom source
definitions live in `data/custom-sources.json` (all git-ignored). Credentials
are never written there — custom HTTP sources reference an environment variable
by name.

## Crawlers & Daemons (settings page)

Open `/settings/adapters` (or the sidebar item) for the adapter control room.
The installed set is the region pack chosen during onboarding; open
`/settings/sources` → **Region** to change it.

- Per-adapter status, access method, capabilities, configuration requirements and
  persisted enable/disable toggles (disabled adapters are skipped by search).
- On-demand and "run all" health checks with real latency and error messages.
- Live node telemetry (`/api/system`) and a real server event stream
  (`/api/events`, polled every 5 s) — no simulated metrics.
- Honest "not built yet" note for the SQLite listing store, cross-source
  deduplication and retention.

Client-side routing uses the History API (no router dependency); the production
server already serves `index.html` for client paths.

## Source plugins (settings page)

Open `/settings/sources` for the source marketplace:

- Catalog recipes (Ricardo community CLI, generic HTTP JSON, built-in eBay/Etsy
  status) with install notes and compliance caveats.
- Add/edit/remove/test custom HTTP JSON or external-command sources; changes
  apply immediately without a restart.
- Installed plugin folders with loaded/error state, adapter ids, environment
  variables and the resolved plugins directory; **Reload plugins** rescans it.
- Enable/disable any custom or plugin adapter (persisted like built-ins).

## API

### `GET /api/search`

| Param | Required | Notes |
| --- | --- | --- |
| `q` | yes | 1–200 characters |
| `market` | no | Buyer market code, e.g. `US` (default `DEFAULT_MARKET`) |
| `sort` | no | `best` \| `newest` (default) \| `price_asc` \| `price_desc` |
| `minPrice` / `maxPrice` | no | non-negative numbers, `minPrice <= maxPrice` |
| `limit` | no | 1–100 (default 48) |

Response: `{ query, market, sort, total, tookMs, isSampleData, listings, sources }`
where `sources[]` reports per-source `status` (`ok`/`error`), count, latency and
a safe error message. Invalid input returns HTTP 400 with a structured error.

### Adapter & system endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/sources?market=` | Full adapter metadata incl. `enabled`, `configured`, `runtimeDisabled`, `markets`, `description`, `auth`, `envVars`, `capabilities`, `docsUrl` |
| `GET /api/markets` | Supported markets with currency, locale, eBay marketplace id, region, setup state and source counts |
| `GET /api/setup` | `{ complete, region, regions[] }` for first-run onboarding |
| `POST /api/setup` | Body `{ "region": "DE" }`; persists the region and re-installs its built-in sources |
| `POST /api/sources/:id/enabled` | Body `{ "enabled": boolean }`, persists the runtime toggle |
| `GET /api/sources/:id/health` | Runs the adapter's health check, returns `{ ok, latencyMs, message, checkedAt }` |
| `POST /api/sources/:id/test` | Runs a one-query live test (`q=velo`, 3 results) and returns ok/latency/count/sample |
| `GET /api/plugins` | Installed plugin statuses, custom sources, catalog and plugins directory |
| `POST /api/plugins/reload` | Rescans `PLUGINS_DIR` and rebuilds optional adapters |
| `POST /api/custom-sources` | Validates + persists an HTTP JSON or command source, then rebuilds the registry |
| `DELETE /api/custom-sources/:id` | Removes a custom source and rebuilds the registry |
| `GET /api/events?limit=` | Recent server events (`info`/`ok`/`error`, max 250) |
| `GET /api/system` | Node/env/uptime/memory + adapter counts |
| `GET /api/health` | Liveness |

## Architecture

```
web/                       React + Vite frontend (CSS Modules + design tokens)
  src/styles/tokens.css    design tokens from DESIGN.md / mockup
  src/components/          Sidebar, SearchControls, SourcePills, FilterRail,
                           ListingCard, Results (loading/empty/error states),
                           SettingsPage, SourcesPage, AdapterCard, EventTerminal
  src/lib/                 API client, formatting, types

server/                    Express + TypeScript search API
  core/types.ts            NormalizedListing + MarketplaceAdapter contract
  core/registry.ts         adapter registry + persisted runtime toggles
  core/custom-sources.ts   operator-defined HTTP JSON / external-command adapters
  core/plugins.ts          optional plugin loader (manifest + dynamic ESM import)
  core/source-catalog.ts   static catalog recipes for the source marketplace
  core/regions.ts          region packs + first-run setup persistence
  core/events.ts           in-memory event log for the settings page
  core/search.ts           validation, fan-out, merge, sort
  api/router.ts            search, sources, plugins, custom sources, events, system
  adapters/ebay.adapter.ts official eBay Browse API adapter
  adapters/scrape.ts       polite HTTP client + price/JSON-LD helpers
  adapters/smg.adapter.ts  shared Tutti/Anibis Next.js parser
  adapters/public-page.adapter.ts shared polite HTML adapter base
  adapters/{tutti,anibis,marko}.adapter.ts Swiss public search pages
  adapters/depop.adapter.ts Depop public search page (opt-in, disabled by default)
  adapters/{devinta,subito,willhaben,kijiji,kleinanzeigen}.adapter.ts regional pages
  adapters/sample.adapter.ts representative dev data (clearly labelled)
```

Every adapter normalizes its native payload into the shared model:

```ts
interface NormalizedListing {
  id: string;               // `${source}:${sourceListingId}`
  source: string;           // adapter id, e.g. "ebay"
  sourceListingId: string;
  title: string;
  description: string;
  price: number | null;
  currency: string;
  location: string | null;
  imageUrl: string | null;
  listingUrl: string;       // original marketplace URL
  publishedAt: string | null;
  fetchedAt: string;
}
```

The frontend never sees marketplace-specific response formats. To add a source
without touching the app, use a custom HTTP/command source or a plugin on
`/settings/sources`. For a first-class built-in, implement `MarketplaceAdapter`
— `isEnabled`, `disabledReason`, `search`, plus the settings metadata
(`description`, `auth`, `envVars`, `capabilities`, `icon`, `docsUrl`) and a
`healthCheck` — then register it in `server/core/registry.ts`.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | API + web dev servers (sample adapter enabled) |
| `npm run build` | Production build of the frontend into `web/dist` |
| `npm start` | Production server (API + built frontend) |
| `npm run typecheck` | `tsc --noEmit` for server and web |

## Known limitations

- Frontend filter rail: price range is functional; canton/condition/fulfillment
  are visually present but disabled (they need a local listing store / richer
  source metadata and are marked "soon").
- No pagination: the API caps results at 100 (default 48) merged across sources.
  Public-page adapters fetch the first SSR page (30 listings) per query.
- No local persistence, cross-source deduplication, saved searches, or alerts
  yet — the same item cross-posted on Tutti and Anibis can appear twice.
- Ricardo has no built-in adapter; the only path is the optional community CLI
  recipe, which the operator installs and which may conflict with site terms.
- GB, FR, ES, US and AU have no bundled local public-page adapter yet; they use
  eBay (API keys) or operator-added custom sources. Gumtree UK currently serves
  an anti-bot challenge, so it is deliberately not bundled.
- Region packs change the installed built-in set; custom sources and plugins are
  always loaded because the operator explicitly installed them.
- Plugin commands/sources are trusted operator code running with server
  privileges; there is no sandbox yet.
- Public-page results are cached for 60 s; repeated identical searches within
  that window are served from memory.


## Per-account data, timeouts and the PWA

- **Saved items and source choices are per account.** Signed in, they are stored
  under `user:<id>`; signed out, under an anonymous device id. On sign-in or
  registration the client sends its device id and the server merges that
  device's saved items (and source choices, if the account has none) into the
  account. `GET /api/sources` returns `userEnabled` for the caller; toggle with
  `POST /api/preferences/sources/:id { enabled }`. The operator switch
  (`POST /api/sources/:id/enabled`) remains the master switch for everyone: a
  person can only turn off sources the operator has enabled.
- **Adapter timeouts.** Each adapter gets an `AbortSignal` that fires at its
  deadline (`ADAPTER_TIMEOUT_MS`, default 30 s, or the adapter's own
  `timeoutMs`). Adapters stop work on abort and may return partial results
  (`sources[].partial`). `PoliteClient` shares one upstream fetch between
  concurrent identical requests and fails fast ("busy") rather than letting a
  long rate-limit queue use up the deadline.
- **PWA.** `web/public/manifest.webmanifest`, `web/public/sw.js` and the icons
  in `web/public/icons/` make the app installable on iOS and Android. The
  service worker never caches `/api/*`. Bump `VERSION` in `sw.js` to
  invalidate caches. Note: an iOS home-screen app has its own storage and
  cookies, so people sign in once inside the installed app.
