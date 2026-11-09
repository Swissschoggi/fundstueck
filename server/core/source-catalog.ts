import type { CustomSourceConfig } from './custom-sources.js';

/**
 * Static "source marketplace" catalog. These are recipes, not bundled code:
 * the app installs nothing on its own, and the UI can prefill the custom
 * source form from a template.
 */
export interface CatalogEntry {
  id: string;
  label: string;
  kind: 'custom-command' | 'custom-http' | 'built-in';
  icon: string;
  markets: string[];
  description: string;
  install: string;
  docsUrl?: string;
  /** Compliance/operational caveat shown prominently in the UI. */
  risk?: string;
  /** Prefill for the custom-source form. Never enabled until the operator saves. */
  template?: Omit<CustomSourceConfig, 'enabled'>;
  /** Optional install command run by the server when the operator clicks "Install". */
  installCommand?: string[];
}

export const SOURCE_CATALOG: CatalogEntry[] = [
  {
    id: 'ricardo-community',
    label: 'Ricardo.ch (community CLI, not installed)',
    kind: 'custom-command',
    icon: 'terminal',
    markets: ['CH'],
    description:
      'Swiss general marketplace. The community project drives a real browser, reads public listing pages and emits JSON that Fundstück can map.',
    install:
      'python3 -m pip install ricardo-scraper   (Python 3.11/3.12; first run downloads a pinned browser build)\n# or clone github.com/danyk20/ricardo-scraper and use: pipenv run python ricardo_scraper.py',
    docsUrl: 'https://github.com/danyk20/ricardo-scraper',
    // Avoid assuming a standalone pip executable exists in container PATH.
    installCommand: ['python3', '-m', 'pip', 'install', 'ricardo-scraper'],
    risk:
      'Not bundled and disabled until you save it. This scraper uses camoufox to satisfy ricardo.ch’s Cloudflare challenge, so it may conflict with Ricardo/Cloudflare terms. Review those terms and keep the default request delay.',
    template: {
      id: 'ricardo-community',
      label: 'Ricardo.ch (community)',
      description:
        'Optional community CLI scraper for ricardo.ch. Runs as an external command and returns summary fields only (--no-detail).',
      markets: ['CH'],
      icon: 'terminal',
      type: 'command',
      command: {
        command: 'ricardo-scraper',
        args: [
          '{query}',
          '--no-detail',
          '--max-results',
          '{limit}',
          '--locale',
          'de',
          '--out',
          '{tmp}',
          '--quiet',
        ],
        timeoutMs: 120000,
        outputFile: '{tmp}.json',
        format: 'ricardo',
      },
    },
  },
  {
    id: 'generic-http-json',
    label: 'HTTP JSON adapter',
    kind: 'custom-http',
    icon: 'api',
    markets: ['CH'],
    description:
      'Point Fundstück at any JSON search endpoint and map its fields with dot paths. Works with your own crawler service, a partner API or an internal aggregator.',
    install: 'No install needed — replace the example URL and field paths, then save.',
    risk:
      'Only use endpoints you are allowed to call. Credentials are read from an environment variable and never stored in the browser.',
    template: {
      id: 'my-json-source',
      label: 'My JSON API',
      description: 'Custom HTTP JSON source.',
      markets: ['CH'],
      icon: 'api',
      type: 'http-json',
      http: {
        url: 'https://api.example.com/search?q={query}&limit={limit}',
        method: 'GET',
        headers: {},
        fields: {
          id: 'id',
          title: 'title',
          price: 'price',
          currency: 'currency',
          location: 'location',
          image: 'image',
          url: 'url',
          description: 'description',
          publishedAt: 'publishedAt',
        },
        priceFactor: 1,
      },
    },
  }
];
