# Product Requirements Document (PRD): SwissHunt
**Version:** 1.0.0  
**Status:** Approved / Architecture-Ready  
**Product Type:** Self-Hosted Swiss Second-Hand Marketplace Aggregator & Arbitrage Radar  
**Target Environment:** Local Docker / Homelab / Linux VPS (Self-Hosted)  
**Primary Market:** Switzerland (Canton-aware, multi-lingual FR/DE/IT, CHF currency)

---

## 1. Executive Summary & Vision

### 1.1 Problem Statement
The Swiss second-hand marketplace ecosystem is heavily fragmented across multiple walled-garden platforms: **Ricardo.ch** (auctions & direct buy), **Tutti.ch** (classifieds, German/Italian focus), **Anibis.ch** (classifieds, Romandie/French focus), and **Facebook Marketplace**. 
Buyers and collectors must manually check multiple apps with inconsistent search filters, differing alert latencies, and frequent crossposted listings where the exact same seller lists an item at different prices across platforms.

### 1.2 Product Vision
**SwissHunt** is a self-hosted, privacy-first meta-search engine and arbitrage radar designed to unify Swiss second-hand discovery. Following a **"Search first, marketplace second"** philosophy, it never hosts transactions or attempts to be a middleman. Instead, it provides a lightning-fast, information-dense unified feed, automated cross-platform duplicate detection, and sub-minute alerting via local webhooks and messaging bots.

---

## 2. Core Product Principles

1. **Search First, Marketplace Second**: SwissHunt does not process payments or broker communications. Every listing links out directly to the source platform.
2. **One Unified Experience**: Normalizes inconsistent filter schemas, cantonal boundaries, and localized languages (German, French, Italian) into a single cohesive interface.
3. **Information-Dense & Modern**: High visual craft built on a pitch-black (`#000000`) aesthetic with instant keyboard ergonomics (`⌘K`), clean typography, and zero visual clutter.
4. **Polite, Resilient Data Acquisition**: Modular adapter architecture adhering strictly to polite scraping principles (configurable rate limits, exponential jitter, graceful degradation, zero CAPTCHA bypass).
5. **Self-Hosted & Zero Cloud Lock-in**: Fully functional within a local SQLite/FTS5 stack with zero external SaaS dependencies.

---

## 3. User Personas

* **The Design & Tech Bargain Hunter**: Looks for iconic Swiss design classics (USM Haller, Vitra) and electronics (PlayStation 5, GPUs). Wants instant notification when a high-delta deal drops below market average.
* **The Regional Swiss Commuter**: Filters strictly within a specific Canton or 15–25 km radius (e.g., Zurich 8001, Geneva 1201) to enable direct cash pickup (Abholung / Barzahlung / TWINT) without postal fees.
* **The Homelab & Privacy Enthusiast**: Runs SwissHunt on a local NAS/Raspberry Pi or unRAID server; demands minimal resource consumption, webhook alerts (Telegram/Discord/Home Assistant), and zero telemetry leakage.

---

## 4. Key Functional Specifications

### 4.1 Unified Search & Aggregated Feed (`/explore`)
* **Omnisearch & Syntax**: Global query bar with `⌘K` shortcut supporting tokens, exact match quotes, and price thresholds (e.g., `Herman Miller max:500 canton:ZH`).
* **Multi-Source Toggle Chips**: Granular enable/disable toggles with live listing count badges per source (Ricardo, Tutti, Anibis, FB Marketplace).
* **Location & Cantonal Filters**:
  * Multi-canton selection chips (ZH, BE, VD, GE, BS, LU, SG, AG, ZG, etc.).
  * Radial slider from reference postal code (e.g., Center: 8001 Zürich, Radius: 5–100 km).
* **Price & Currency Normalization**: Range sliders and manual inputs in Swiss Francs (CHF).
* **Fulfillment Toggles**: Direct Pickup (*Abholung*), Standard Swiss Post (*A-Post / B-Post*), Bulky Dispatch (*Spedition*).
* **Condition Normalization**: Map heterogeneous source tags to standardized tiers (*Brand New*, *Like New / Mint*, *Used*, *Refurbished*).

### 4.2 Cross-Platform Duplicate Detection & Arbitrage Radar (`/item/:id`)
* **Algorithmic Matching Engine**:
  * **Title Similarity**: Levenshtein Distance & Token Cosine Similarity (default 85% confidence threshold).
  * **Perceptual Image Hashing (pHash)**: 64-bit Hamming distance comparison on main thumbnail photos to match identical photos reused across sites.
  * **Metadata Verification**: Cross-referencing masked phone numbers, canton location, and seller usernames.
* **Arbitrage Delta Callout**: Explicit highlight showing price differences for identical items across platforms (e.g., *CHF 450 on Ricardo vs CHF 420 on Tutti → Saves CHF 30*).
* **Automated Valuation Model (AVM)**: 90-day moving average and fair value corridor based on completed transaction history in Switzerland.
* **Direct External Handoff**: Prominent CTAs opening the original listing in a new browser tab.

### 4.3 Automated Watchers & Alert Hub (`/alerts`)
* **Persistent Query Daemons**: Continuous background evaluation of active queries.
* **Instant Delivery Channels**:
  * **Telegram Bot**: Formatted markdown alerts with direct links and image previews.
  * **Discord Webhook**: Rich embedded cards with pricing delta and source badges.
  * **Home Assistant**: Local REST webhook for home automation triggers.
  * **Ntfy / Gotify / Desktop Push**: Lightweight self-hosted push notifications.
* **Deduplication Suppression**: Prevents firing multiple alert pings if an item is picked up on both Ricardo and Tutti simultaneously.

### 4.4 Modular Source Adapters & Scraper Daemons (`/settings/daemons`)
* **Adapter Interface Protocol**: Pluggable adapter contracts defining `search()`, `fetchDetails()`, and `healthCheck()`.
* **Initial Marketplace Connectors**:
  * **Ricardo.ch**: Hybrid official search endpoints with auction timer sync.
  * **Tutti.ch**: Localized JSON API stream with postal code parsing.
  * **Anibis.ch**: Fast Cheerio/DOM parser with bilingual category mapping (FR/DE).
  * **Facebook Marketplace**: Headless Chromium runner with persistent cookies.
* **Polite Scraping Governance**:
  * Configurable request caps (e.g., 20 req/min for Ricardo, 4 req/min for FB).
  * Randomized delay jitter (1.2s – 2.8s) to prevent IP blocking.
  * Instant daemon suspension on consecutive HTTP 429/403 responses.

---

## 5. Technical & System Architecture

```
[ SwissHunt Web UI ] <--- (Tailwind CSS / Next.js or SvelteKit)
       │
[ Local REST / WebSocket API ]
       │
┌──────┴───────────────────────────────────────────────────────┐
│                 SwissHunt Core Engine                        │
│                                                              │
│  ┌────────────────────┐            ┌──────────────────────┐  │
│  │ Ingestion Scheduler│            │ Deduplication Engine │  │
│  │ (Cron / Async Loop)│            │ (Cosine + pHash)     │  │
│  └─────────┬──────────┘            └──────────┬───────────┘  │
│            │                                  │              │
│  ┌─────────▼──────────────────────────────────▼───────────┐  │
│  │ Local SQLite Engine (WAL Mode + FTS5 Full Text Search) │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬───────────────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
┌────────────────────────┐              ┌────────────────────┐
│   Marketplace Adapters │              │ Notification Hub   │
│ ├─ Ricardo.ch (GraphQL)│              │ ├─ Telegram Bot    │
│ ├─ Tutti.ch (JSON REST)│              │ ├─ Discord Webhook │
│ ├─ Anibis.ch (Cheerio) │              │ ├─ Home Assistant  │
│ └─ FB Market (Headless)│              │ └─ Ntfy / Web Push │
└────────────────────────┘              └────────────────────┘
```

* **Storage Footprint**:
  * SQLite3 database with Full Text Search 5 (FTS5) for sub-millisecond local querying.
  * Local image cache converting remote thumbnails into compressed WebP format.
  * Automatic vacuum & prune routines for expired listings (configurable 7/30/90 days).

---

## 6. Non-Functional Requirements & Compliance

* **Performance**: Search query response under 50ms for local SQLite lookups; adapter ingestion pulse cycle between 15s and 60s.
* **Memory & Resource Cap**: Max node heap under 300MB RAM to ensure seamless execution on low-cost devices (e.g. Raspberry Pi 4).
* **Legal & Ethics Compliance**: Strict adherence to public indexation boundaries; no credential stuffing, no anti-bot or CAPTCHA circumvention, and zero scraping of private user contact data.

---

## 7. Delivery Roadmap & Milestones

* **Milestone 1 (Foundations)**: Core SQLite schema, generic adapter contract, and Ricardo + Tutti stream ingestion.
* **Milestone 2 (Search UI & Deduplication)**: Modern desktop search interface (`/explore`), dual-slider filters, and Cosine + pHash deduplication engine.
* **Milestone 3 (Alerting Hub)**: Telegram & Discord webhook integrations with duplicate suppression.
* **Milestone 4 (Admin Controls & Polishing)**: Scraper daemon controls, local cache maintenance, and Anibis + FB Marketplace adapter integrations.
