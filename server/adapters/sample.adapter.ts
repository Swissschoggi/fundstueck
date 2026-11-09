import type {
  AdapterHealth,
  AdapterSearchParams,
  MarketplaceAdapter,
  NormalizedListing,
} from '../core/types.js';

interface SampleItem {
  title: string;
  description: string;
  price: number;
  location: string;
  minutesAgo: number;
  /** Real marketplace this item is modelled on — used only for the outbound link. */
  site: 'ricardo.ch' | 'tutti.ch' | 'anibis.ch';
  queryHint: string;
}

/**
 * Representative Swiss-marketplace sample data for development.
 * Never returned in production unless explicitly enabled (see config.ts),
 * and always flagged to the client via mode "sample".
 */
const SAMPLE_ITEMS: SampleItem[] = [
  { title: 'Lenovo ThinkPad T14 Gen 2 (Ryzen 5, 16GB RAM, 512GB SSD)', description: 'Sehr guter Zustand · 14" FHD IPS · neue Batterie mit 96% Kapazität · inkl. USB-C Netzteil', price: 420, location: 'Zürich 8004', minutesAgo: 18, site: 'ricardo.ch', queryHint: 'ThinkPad' },
  { title: 'Lenovo ThinkPad X1 Carbon Gen 9 — i7 / 16GB / 1TB', description: 'Wie neu · Carbon-Gehäuse ohne Kratzer · 4G LTE Modul · Restgarantie bis März', price: 890, location: 'Bern 3008', minutesAgo: 52, site: 'tutti.ch', queryHint: 'ThinkPad' },
  { title: 'ThinkPad T480 mit 2 Akkus — ab 1.-', description: 'Gebraucht aber top gepflegt · i5-8350U · 16GB RAM · 256GB SSD · Hot-Swap Akku', price: 260, location: 'Winterthur 8400', minutesAgo: 130, site: 'anibis.ch', queryHint: 'ThinkPad' },
  { title: 'Lenovo USB-C Docking Station 40AS (ThinkPad)', description: 'Für ThinkPad T/X/L · 2x DisplayPort · 90W Ladefunktion · mit Netzteil', price: 85, location: 'Zug 6300', minutesAgo: 480, site: 'ricardo.ch', queryHint: 'ThinkPad Dock' },
  { title: 'Herman Miller Aeron Chair (Graphite, Grösse B)', description: 'Fully Loaded · Forward Tilt · PostureFit · Ausstellungsstück aus Büro-Auflösung', price: 450, location: 'Zürich 8005', minutesAgo: 21, site: 'ricardo.ch', queryHint: 'Herman Miller' },
  { title: 'USM Haller Sideboard 2×2 — Reinweiss', description: '75×70cm · 2 Klappen · Chromrohr makellos · Original-Belege vorhanden', price: 680, location: 'Basel 4052', minutesAgo: 135, site: 'ricardo.ch', queryHint: 'USM Haller' },
  { title: 'USM Haller TV-Board — Anthrazit, 3 Klappen', description: '150×35cm · wenig gebraucht · Abholung bevorzugt · Diskussionsspielraum', price: 520, location: 'Luzern 6004', minutesAgo: 890, site: 'tutti.ch', queryHint: 'USM Haller' },
  { title: 'Vintage Mondaine SBB Bahnhofsuhr 25cm', description: 'Aluminium gebürstet · mint condition · mit Originalverpackung', price: 120, location: 'Bern 3011', minutesAgo: 42, site: 'tutti.ch', queryHint: 'Mondaine' },
  { title: 'Sony PlayStation 5 Disc Edition + 2 Controller', description: 'Wie neu · 825GB SSD · Ladestation · 3 Spiele inklusive · Quittung Digitec', price: 380, location: 'Luzern 6003', minutesAgo: 64, site: 'tutti.ch', queryHint: 'PlayStation' },
  { title: 'Freitag F13 TOP CAT Messenger — 1-of-1', description: 'Original Cut · Gurt gereinigt & ersetzt · ikonisches Modell · einzigartiges Motiv', price: 140, location: 'Winterthur 8400', minutesAgo: 245, site: 'tutti.ch', queryHint: 'Freitag' },
  { title: 'Freitag F411 Laptop Sleeve 13"', description: 'Nicht mehr erhältliches Modell · kaum gebraucht · Plane grau/schwarz', price: 95, location: 'St. Gallen 9000', minutesAgo: 1500, site: 'anibis.ch', queryHint: 'Freitag' },
  { title: 'Scott Scale 965 Mountainbike (29", Gr. L)', description: 'Kürzlich service · neue Maxxis Reifen · Shimano SLX 1×12 · RockShox Judy', price: 750, location: 'Genève 1201', minutesAgo: 190, site: 'anibis.ch', queryHint: 'MTB' },
  { title: 'iPhone 15 Pro 256GB Titan Natur', description: 'Neuwertig · Akku 98% · immer mit Case & Glas · komplette Originalverpackung', price: 720, location: 'Lausanne 1007', minutesAgo: 300, site: 'ricardo.ch', queryHint: 'iPhone' },
  { title: 'Leica M6 TTL 0.85 — schwarz', description: 'Funktioniert einwandfrei · CLA 2023 · leichte Gebrauchsspuren am Gehäuse', price: 3250, location: 'Zürich 8001', minutesAgo: 2600, site: 'ricardo.ch', queryHint: 'Leica' },
  { title: 'Vitra Eames Lounge Chair & Ottoman (schwarz)', description: 'Neues Modell (Palisander) · von 2021 · NP 8’500.– · Top Zustand', price: 2400, location: 'Zürich 8038', minutesAgo: 4200, site: 'tutti.ch', queryHint: 'Vitra' },
  { title: 'Rolex Datejust 36 (Ref. 116234, Full Set)', description: 'Box & Papiere 2019 · Fluted Bezel · unpoliert · Service bei Rolex Genf 2023', price: 5900, location: 'Genève 1204', minutesAgo: 6100, site: 'ricardo.ch', queryHint: 'Rolex' },
  { title: 'MacBook Pro 14" M3 Pro — 18GB / 512GB', description: 'Kaum gebraucht · 12 Ladezyklen · AppleCare+ bis 2026 · Rechnung vorhanden', price: 1850, location: 'Zürich 8006', minutesAgo: 95, site: 'anibis.ch', queryHint: 'MacBook' },
  { title: 'Sonos One SL (Paar, schwarz)', description: 'Zwei Speaker als Set · einwandfrei · mit Stromkabel · Nichtraucherhaushalt', price: 110, location: 'Thun 3600', minutesAgo: 7200, site: 'tutti.ch', queryHint: 'Sonos' },
];

function searchUrl(site: SampleItem['site'], query: string): string {
  const q = encodeURIComponent(query);
  switch (site) {
    case 'ricardo.ch':
      return `https://www.ricardo.ch/de/s/${q}`;
    case 'tutti.ch':
      return `https://www.tutti.ch/de/s?q=${q}`;
    case 'anibis.ch':
      return `https://www.anibis.ch/de/s?q=${q}`;
  }
}

/**
 * Development adapter backed by a curated, deterministic dataset.
 * It behaves exactly like a live adapter (token matching, limit) so the
 * whole search journey works before marketplace credentials are set up.
 * Results are explicitly mode "sample" and labelled in the UI.
 */
export class SampleAdapter implements MarketplaceAdapter {
  readonly id = 'sample';
  readonly label = 'Sample (dev)';
  readonly mode = 'sample' as const;
  readonly icon = 'science';
  readonly markets = ['CH'];
  readonly auth = 'Local dataset · no network';
  readonly envVars = ['ENABLE_SAMPLE_ADAPTER'];
  readonly capabilities = [
    `${SAMPLE_ITEMS.length} curated listings`,
    'Deterministic timestamps',
    'Offline development',
    'Always labelled in results',
  ];
  readonly description =
    'Deterministic representative dataset for development and demos. It exercises the ' +
    'full search journey without credentials. Sample results are always labelled and ' +
    'are never served as live listings. Disabled by default in production.';

  constructor(private readonly enabled: boolean) {}

  isEnabled(): boolean {
    return this.enabled;
  }

  disabledReason(): string | null {
    return this.enabled
      ? null
      : 'Disabled — set ENABLE_SAMPLE_ADAPTER=true to use representative sample data';
  }

  async healthCheck(): Promise<AdapterHealth> {
    const started = Date.now();
    return {
      ok: this.enabled,
      latencyMs: Date.now() - started,
      message: this.enabled
        ? `Local dataset ready: ${SAMPLE_ITEMS.length} sample listings.`
        : 'Sample adapter is disabled by configuration.',
    };
  }

  async search(params: AdapterSearchParams): Promise<NormalizedListing[]> {
    const tokens = params.q.toLowerCase().split(/\s+/).filter(Boolean);
    const now = Date.now();

    const matches = SAMPLE_ITEMS.filter((item) => {
      const haystack = `${item.title} ${item.description} ${item.location} ${item.queryHint}`.toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    }).slice(0, params.limit);

    const fetchedAt = new Date().toISOString();
    return matches.map((item, i) => ({
      id: `${this.id}:${i}-${item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      source: this.id,
      sourceListingId: `sample-${i}`,
      title: item.title,
      description: item.description,
      price: item.price,
      currency: 'CHF',
      location: item.location,
      imageUrl: null,
      // Sample items link to the real marketplace's public search page —
      // sufficiently generic to never impersonate a real listing.
      listingUrl: searchUrl(item.site, item.queryHint),
      publishedAt: new Date(now - item.minutesAgo * 60_000).toISOString(),
      fetchedAt,
    }));
  }
}
