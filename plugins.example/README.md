# Source plugins (optional)

Nothing in this folder is installed or loaded by default. To install a plugin:

```bash
mkdir -p plugins
cp -R plugins.example/demo-http plugins/demo-http
```

Then restart the server or press **Reload plugins** on
`/settings/sources`. The plugin's adapters join the normal registry and are
enabled/disabled/tested like built-in sources.

## Manifest — `plugin.json`

```json
{
  "id": "my-source",
  "label": "My source",
  "description": "What it searches.",
  "icon": "extension",
  "markets": ["CH", "DE"],
  "module": "./index.js",
  "envVars": ["MY_API_KEY"],
  "docsUrl": "https://example.com/docs"
}
```

- `id`: 2–40 chars, `a-z0-9-`, starts with a letter; must be unique.
- `module`: relative path inside the plugin folder (`.js`, `.mjs` or `.ts`).
- `markets`: optional display hint; the adapter's own `markets` wins.

## Module contract

Export `createAdapters(ctx)` (or a default function) returning one adapter or
an array. `ctx` contains `{ env, userAgent, minIntervalMs, dataDir }`.
Adapters must implement the same `MarketplaceAdapter` interface as the
built-ins: `id`, `label`, `mode`, `description`, `auth`, `envVars`,
`capabilities`, `icon`, `markets`, `isEnabled()`, `disabledReason()`,
`healthCheck()` and `search({ q, limit, market })`.

Failed plugins are isolated: the status and error are shown in the UI and
the rest of the registry keeps working.

## Trust

Plugins are operator-installed local code and run in-process with the
server, so only install plugins you trust. Secrets should come from
environment variables via `ctx.env`.
