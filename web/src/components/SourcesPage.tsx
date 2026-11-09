import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteCustomSource,
  fetchPlugins,
  fetchSources,
  reloadPlugins,
  saveCustomSource,
  saveAdapterConfig,
  setAdapterEnabled,
  testSource,
} from '../lib/api';
import type {
  AdapterInfo,
  CatalogEntry,
  CustomFieldMap,
  CustomSourceConfig,
  CustomSourceDraft,
  PluginsResponse,
  SourceTestResult,
} from '../lib/types';
import { Icon } from './Icon';
import styles from './Sources.module.css';

interface FormState {
  id: string;
  label: string;
  description: string;
  markets: string;
  icon: string;
  type: 'http-json' | 'command';
  url: string;
  method: 'GET' | 'POST';
  apiKeyEnv: string;
  apiKeyValue: string;
  responsePath: string;
  priceFactor: string;
  fieldId: string;
  fieldTitle: string;
  fieldPrice: string;
  fieldCurrency: string;
  fieldLocation: string;
  fieldImage: string;
  fieldUrl: string;
  fieldDescription: string;
  fieldPublishedAt: string;
  command: string;
  argsText: string;
  cwd: string;
  timeoutMs: string;
  outputFile: string;
  format: 'auto' | 'ricardo';
}

const EMPTY_FORM: FormState = {
  id: '',
  label: '',
  description: '',
  markets: 'CH',
  icon: 'extension',
  type: 'http-json',
  url: '',
  method: 'GET',
  apiKeyEnv: '',
  apiKeyValue: '',
  responsePath: '',
  priceFactor: '1',
  fieldId: 'id',
  fieldTitle: 'title',
  fieldPrice: 'price',
  fieldCurrency: 'currency',
  fieldLocation: 'location',
  fieldImage: 'image',
  fieldUrl: 'url',
  fieldDescription: 'description',
  fieldPublishedAt: 'publishedAt',
  command: '',
  argsText: '{query}\n--max-results\n{limit}',
  cwd: '',
  timeoutMs: '60000',
  outputFile: '',
  format: 'auto',
};

function formFromDraft(draft: CustomSourceDraft): FormState {
  const http = draft.http;
  const command = draft.command;
  return {
    ...EMPTY_FORM,
    id: draft.id,
    label: draft.label,
    description: draft.description,
    markets: draft.markets.join(', '),
    icon: draft.icon,
    type: draft.type,
    url: http?.url ?? '',
    method: http?.method ?? 'GET',
    apiKeyEnv: http?.apiKeyEnv ?? '',
    apiKeyValue: '',
    responsePath: http?.responsePath ?? '',
    priceFactor: String(http?.priceFactor ?? 1),
    fieldId: http?.fields.id ?? '',
    fieldTitle: http?.fields.title ?? '',
    fieldPrice: http?.fields.price ?? '',
    fieldCurrency: http?.fields.currency ?? '',
    fieldLocation: http?.fields.location ?? '',
    fieldImage: http?.fields.image ?? '',
    fieldUrl: http?.fields.url ?? '',
    fieldDescription: http?.fields.description ?? '',
    fieldPublishedAt: http?.fields.publishedAt ?? '',
    command: command?.command ?? '',
    argsText: command?.args.join('\n') ?? '{query}\n--max-results\n{limit}',
    cwd: command?.cwd ?? '',
    timeoutMs: String(command?.timeoutMs ?? 60000),
    outputFile: command?.outputFile ?? '',
    format: command?.format ?? 'auto',
  };
}

function formFromConfig(config: CustomSourceConfig): FormState {
  return formFromDraft(config);
}

function draftFromForm(form: FormState): CustomSourceDraft {
  const markets = form.markets
    .split(',')
    .map((m) => m.trim().toUpperCase())
    .filter(Boolean);
  const base = {
    id: form.id.trim().toLowerCase(),
    label: form.label.trim(),
    description: form.description.trim(),
    markets,
    icon: form.icon.trim() || 'extension',
    type: form.type,
  };
  if (form.type === 'http-json') {
    const fields: CustomFieldMap = {};
    const candidates: [keyof CustomFieldMap, string][] = [
      ['id', form.fieldId],
      ['title', form.fieldTitle],
      ['price', form.fieldPrice],
      ['currency', form.fieldCurrency],
      ['location', form.fieldLocation],
      ['image', form.fieldImage],
      ['url', form.fieldUrl],
      ['description', form.fieldDescription],
      ['publishedAt', form.fieldPublishedAt],
    ];
    for (const [key, value] of candidates) {
      const trimmed = value.trim();
      if (trimmed) fields[key] = trimmed;
    }
    return {
      ...base,
      http: {
        url: form.url.trim(),
        method: form.method,
        headers: {},
        apiKeyEnv: form.apiKeyEnv.trim() || undefined,
        responsePath: form.responsePath.trim() || undefined,
        fields,
        priceFactor: Number(form.priceFactor) || 1,
      },
    };
  }
  return {
    ...base,
    command: {
      command: form.command.trim(),
      args: form.argsText
        .split('\n')
        .map((a) => a.trim())
        .filter(Boolean),
      cwd: form.cwd.trim() || undefined,
      timeoutMs: Number(form.timeoutMs) || 60000,
      outputFile: form.outputFile.trim() || undefined,
      format: form.format,
    },
  };
}


function endpointSummary(config: CustomSourceConfig): string {
  if (config.type === 'command') {
    const c = config.command;
    return c ? `${c.command} ${c.args.join(' ')}`.trim() : 'No command';
  }
  return config.http?.url ?? 'No endpoint';
}

function kindLabel(kind: CatalogEntry['kind']): string {
  if (kind === 'custom-command') return 'external CLI';
  if (kind === 'custom-http') return 'HTTP JSON';
  return 'built-in';
}

export function SourcesPage({ onNavigate }: { onNavigate: (to: string) => void }) {
  const [data, setData] = useState<PluginsResponse | null>(null);
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tests, setTests] = useState<Record<string, SourceTestResult | 'running'>>({});
  const formRef = useRef<HTMLDivElement>(null);
  const autoOpened = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [plugins, sources] = await Promise.all([fetchPlugins(), fetchSources()]);
      setData(plugins);
      setAdapters(sources);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load source settings.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Deep links: ?add=1, ?edit=<id>, ?template=<catalog-id>.
  useEffect(() => {
    if (autoOpened.current || !data) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('add') === '1') {
      autoOpened.current = true;
      setForm({ ...EMPTY_FORM });
    } else if (params.get('edit')) {
      const source = data.customSources.find((s) => s.id === params.get('edit'));
      if (source) {
        autoOpened.current = true;
        setEditing(source.id);
        setForm(formFromConfig(source));
      }
    } else if (params.get('template')) {
      const entry = data.catalog.find((c) => c.id === params.get('template'));
      if (entry?.template) {
        autoOpened.current = true;
        setForm(formFromDraft(entry.template));
        setNotice(`Prefilled "${entry.label}". Review it, then save to install.`);
      }
    }
  }, [data]);

  const adapterById = useMemo(() => {
    const map = new Map<string, AdapterInfo>();
    for (const adapter of adapters) map.set(adapter.source, adapter);
    return map;
  }, [adapters]);

  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installMsg, setInstallMsg] = useState<string | null>(null);

  const installCatalog = async (entry: CatalogEntry) => {
    setInstallingId(entry.id);
    setInstallMsg(null);
    try {
      const res = await fetch(`/api/catalog/${encodeURIComponent(entry.id)}/install`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      setInstallMsg(`Installed ${entry.id}: ${body.stdout?.slice(-200) ?? 'ok'}`);
    } catch (err) {
      setInstallMsg(err instanceof Error ? err.message : 'Install failed');
    } finally {
      setInstallingId(null);
    }
  };

  const startTemplate = (entry: CatalogEntry) => {
    if (!entry.template) {
      onNavigate('/settings/adapters');
      return;
    }
    setEditing(null);
    setForm(formFromDraft(entry.template));
    setNotice(`Prefilled "${entry.label}". Review the command/URL, then save to install it.`);
    setError(null);
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);
  };

  const startEdit = (source: CustomSourceConfig) => {
    setEditing(source.id);
    setForm(formFromConfig(source));
    setNotice(null);
    setError(null);
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);
  };

  const cancelForm = () => {
    setForm(null);
    setEditing(null);
  };

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const draft = draftFromForm(form);
      const saved = await saveCustomSource(draft);
      // Persist any secret token the operator typed into the secure store
      // (data/adapter-config.json) instead of the source definition.
      if (form.apiKeyValue && form.apiKeyValue.trim()) {
        await saveAdapterConfig(saved.source.source, { apiKey: form.apiKeyValue.trim() });
      }
      await refresh();
      setNotice(`Installed "${saved.source.label}". It is now part of the adapter fleet.`);
      setForm(null);
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the source.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (source: CustomSourceConfig) => {
    if (!window.confirm(`Remove the custom source "${source.label}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteCustomSource(source.id);
      await refresh();
      setNotice(`Removed "${source.label}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the source.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (source: CustomSourceConfig, enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await setAdapterEnabled(source.id, enabled);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the source.');
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async (id: string) => {
    setTests((prev) => ({ ...prev, [id]: 'running' }));
    try {
      const result = await testSource(id);
      setTests((prev) => ({ ...prev, [id]: result }));
    } catch (err) {
      setTests((prev) => ({
        ...prev,
        [id]: {
          source: id,
          ok: false,
          latencyMs: 0,
          error: err instanceof Error ? err.message : 'Test request failed.',
        },
      }));
    }
  };

  const handleReload = async () => {
    setBusy(true);
    setError(null);
    try {
      await reloadPlugins();
      await refresh();
      setNotice('Plugins reloaded from disk.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reload plugins.');
    } finally {
      setBusy(false);
    }
  };

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const loadedPlugins = data?.plugins.filter((p) => p.loaded).length ?? 0;
  const customCount = data?.customSources.length ?? 0;
  const installedIds = new Set((data?.customSources ?? []).map((source) => source.id));
  const catalogEntries = (data?.catalog ?? []).filter(
    (entry) => !entry.template || !installedIds.has(entry.template.id),
  );
  const catalogCount = catalogEntries.length;
  const isEditing = editing != null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <div className={styles.breadcrumb}>
            <span>Settings</span>
            <span className={styles.crumbSep}>/</span>
            <span className={styles.crumbAccent}>Source plugins</span>
          </div>
          <h1 className={styles.title}>Source Marketplace &amp; Custom Adapters</h1>
          <p className={styles.subtitle}>
            Optional sources are installed by the operator, never bundled with the app.
            Add an HTTP JSON endpoint, run an external CLI, or drop a folder into the
            plugins directory. Built-in adapters stay on the{' '}
            <button type="button" className={styles.inlineLink} onClick={() => onNavigate('/settings/adapters')}>
              Crawlers &amp; Daemons
            </button>{' '}
            page.
          </p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.secondaryButton} onClick={() => onNavigate('/setup')}>
            <Icon name="public" size={16} />
            Region {data?.region ?? '—'} · change
          </button>
          <button type="button" className={styles.secondaryButton} onClick={() => onNavigate('/settings/adapters')}>
            <Icon name="dns" size={16} />
            Adapters
          </button>
          <button type="button" className={styles.secondaryButton} onClick={handleReload} disabled={busy}>
            <Icon name="refresh" size={16} />
            Reload plugins
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => {
              setEditing(null);
              setForm({ ...EMPTY_FORM });
              setNotice(null);
              setError(null);
              window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);
            }}
          >
            <Icon name="add" size={16} />
            Add custom source
          </button>
        </div>
      </header>

      {error && (
        <div className={styles.errorBanner} role="alert">
          <Icon name="error" size={16} />
          <span>{error}</span>
        </div>
      )}
      {notice && !error && (
        <div className={styles.noticeBanner} role="status">
          <Icon name="check_circle" size={16} />
          <span>{notice}</span>
          <button type="button" className={styles.dismiss} onClick={() => setNotice(null)} aria-label="Dismiss">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      <section className={styles.stats}>
        <div className={styles.statCard}>
          <Icon name="extension" size={18} />
          <div>
            <span className={styles.statLabel}>Installed plugins</span>
            <span className={styles.statValue}>{loadedPlugins} loaded</span>
          </div>
        </div>
        <div className={styles.statCard}>
          <Icon name="tune" size={18} />
          <div>
            <span className={styles.statLabel}>Custom sources</span>
            <span className={styles.statValue}>{customCount} configured</span>
          </div>
        </div>
        <div className={styles.statCard}>
          <Icon name="storefront" size={18} />
          <div>
            <span className={styles.statLabel}>Catalog recipes</span>
            <span className={styles.statValue}>{catalogCount} available</span>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <h2 className={styles.sectionTitle}>Catalog</h2>
            <p className={styles.sectionSub}>
              Recipes prefill the form. Nothing is downloaded, installed or enabled until you save it.
            </p>
          </div>
        </div>

        <div className={styles.catalogGrid}>
          {catalogEntries.map((entry) => (
            <article key={entry.id} className={styles.catalogCard}>
              <div className={styles.cardTop}>
                <div className={styles.identity}>
                  <div className={styles.iconBox}>
                    <Icon name={entry.icon} size={18} />
                  </div>
                  <div className={styles.names}>
                    <span className={styles.cardName}>{entry.label}</span>
                    <span className={styles.slug}>{entry.id}</span>
                  </div>
                </div>
                <span className={styles.kindBadge}>{kindLabel(entry.kind)}</span>
              </div>
              <p className={styles.cardDesc}>{entry.description}</p>
              <div className={styles.chipRow}>
                {entry.markets.map((m) => (
                  <span key={m} className={styles.chip}>{m}</span>
                ))}
              </div>
              <pre className={styles.install}>{entry.install}</pre>
              {installMsg && entry.installCommand && (
                <p className={styles.risk}>{installMsg}</p>
              )}
              {entry.risk && (
                <p className={styles.risk}>
                  <Icon name="warning" size={14} />
                  <span>{entry.risk}</span>
                </p>
              )}
              <div className={styles.cardActions}>
                {entry.installCommand && (
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={installingId === entry.id}
                    onClick={() => installCatalog(entry)}
                  >
                    <Icon name="build" size={14} />
                    {installingId === entry.id ? 'Installing…' : 'Install binary'}
                  </button>
                )}
                {entry.docsUrl && (
                  <a className={styles.linkButton} href={entry.docsUrl} target="_blank" rel="noreferrer">
                    <Icon name="open_in_new" size={14} />
                    Docs
                  </a>
                )}
                <button
                  type="button"
                  className={entry.template ? styles.primaryButton : styles.secondaryButton}
                  onClick={() => startTemplate(entry)}
                >
                  <Icon name={entry.template ? 'download' : 'dns'} size={14} />
                  {entry.template ? 'Use template' : 'Manage adapters'}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <h2 className={styles.sectionTitle}>Custom sources</h2>
            <p className={styles.sectionSub}>
              Persisted in <code>data/custom-sources.json</code>. Secrets belong in environment variables, not headers.
            </p>
          </div>
        </div>

        {customCount === 0 ? (
          <div className={styles.emptyPanel}>
            No custom sources yet. Use a catalog recipe or add an HTTP JSON / external command source.
          </div>
        ) : (
          <div className={styles.customGrid}>
            {data?.customSources.map((source) => {
              const adapter = adapterById.get(source.id);
              const test = tests[source.id];
              return (
                <article key={source.id} className={styles.customCard}>
                  <div className={styles.cardTop}>
                    <div className={styles.identity}>
                      <div className={styles.iconBox}>
                        <Icon name={source.icon} size={18} />
                      </div>
                      <div className={styles.names}>
                        <span className={styles.cardName}>{source.label}</span>
                        <span className={styles.slug}>
                          {source.id} · {source.type === 'command' ? 'external CLI' : 'HTTP JSON'}
                        </span>
                      </div>
                    </div>
                    <span
                      className={`${styles.statusPill} ${
                        adapter?.enabled
                          ? styles.statusOn
                          : adapter?.configured
                            ? styles.statusOff
                            : styles.statusErr
                      }`}
                    >
                      <span className={styles.statusDot} />
                      {adapter?.enabled ? 'enabled' : adapter?.configured ? 'disabled' : 'unavailable'}
                    </span>
                  </div>
                  <p className={styles.cardDesc}>{source.description || 'No description.'}</p>
                  <div className={styles.chipRow}>
                    {source.markets.map((m) => (
                      <span key={m} className={styles.chip}>{m}</span>
                    ))}
                  </div>
                  <pre className={styles.install}>{endpointSummary(source)}</pre>
                  {adapter?.disabledReason && (
                    <p className={styles.risk}>
                      <Icon name="warning" size={14} />
                      <span>{adapter.disabledReason}</span>
                    </p>
                  )}
                  {test === 'running' && <p className={styles.testLine}>Running test search…</p>}
                  {test && test !== 'running' && (
                    <p className={`${styles.testLine} ${test.ok ? styles.testOk : styles.testErr}`}>
                      <Icon name={test.ok ? 'check_circle' : 'error'} size={14} />
                      {test.ok
                        ? `OK · ${test.count ?? 0} listings in ${test.latencyMs}ms`
                        : test.error ?? 'Test failed.'}
                    </p>
                  )}
                  <div className={styles.cardActions}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => handleTest(source.id)}
                      disabled={test === 'running'}
                    >
                      <Icon name="play_arrow" size={14} />
                      Test
                    </button>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => handleToggle(source, !(adapter?.enabled ?? false))}
                      disabled={busy || !adapter?.configured}
                    >
                      <Icon name={adapter?.enabled ? 'pause' : 'play_arrow'} size={14} />
                      {adapter?.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button type="button" className={styles.secondaryButton} onClick={() => startEdit(source)}>
                      <Icon name="edit" size={14} />
                      Edit
                    </button>
                    <button
                      type="button"
                      className={styles.dangerButton}
                      onClick={() => handleDelete(source)}
                      disabled={busy}
                    >
                      <Icon name="delete" size={14} />
                      Remove
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {form && (
        <section className={styles.section} ref={formRef}>
          <div className={styles.sectionHead}>
            <div>
              <h2 className={styles.sectionTitle}>
                {isEditing ? `Edit "${form.label || form.id}"` : 'Add custom source'}
              </h2>
              <p className={styles.sectionSub}>
                Placeholders: <code>{'{query}'}</code>, <code>{'{limit}'}</code>,{' '}
                <code>{'{market}'}</code> and <code>{'{tmp}'}</code> (command output file base).
              </p>
            </div>
            <button type="button" className={styles.secondaryButton} onClick={cancelForm}>
              <Icon name="close" size={14} />
              Cancel
            </button>
          </div>

          <div className={styles.formCard}>
            <div className={styles.formRow}>
              <label className={styles.field}>
                <span>Type</span>
                <select
                  value={form.type}
                  onChange={(e) => update('type', e.target.value as FormState['type'])}
                  disabled={isEditing}
                >
                  <option value="http-json">HTTP JSON endpoint</option>
                  <option value="command">External command (CLI)</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>Source ID</span>
                <input
                  value={form.id}
                  onChange={(e) => update('id', e.target.value)}
                  placeholder="my-source"
                  disabled={isEditing}
                />
              </label>
              <label className={styles.field}>
                <span>Label</span>
                <input
                  value={form.label}
                  onChange={(e) => update('label', e.target.value)}
                  placeholder="My marketplace"
                />
              </label>
              <label className={styles.field}>
                <span>Markets (comma separated)</span>
                <input value={form.markets} onChange={(e) => update('markets', e.target.value)} placeholder="CH, DE" />
              </label>
              <label className={styles.field}>
                <span>Icon (Material Symbol name)</span>
                <input value={form.icon} onChange={(e) => update('icon', e.target.value)} placeholder="extension" />
              </label>
            </div>

            <label className={styles.field}>
              <span>Description</span>
              <textarea
                value={form.description}
                onChange={(e) => update('description', e.target.value)}
                rows={2}
                placeholder="What this source covers and which access path it uses."
              />
            </label>

            {form.type === 'http-json' ? (
              <div className={styles.subForm}>
                <div className={styles.formRow}>
                  <label className={`${styles.field} ${styles.wide}`}>
                    <span>Search URL</span>
                    <input
                      value={form.url}
                      onChange={(e) => update('url', e.target.value)}
                      placeholder="https://api.example.com/search?q={query}&limit={limit}"
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Method</span>
                    <select value={form.method} onChange={(e) => update('method', e.target.value as FormState['method'])}>
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span>API key env var</span>
                    <input
                      value={form.apiKeyEnv}
                      onChange={(e) => update('apiKeyEnv', e.target.value)}
                      placeholder="MY_API_KEY"
                    />
                  </label>
                  <label className={styles.field}>
                    <span>API key value (stored securely)</span>
                    <input
                      type="password"
                      value={form.apiKeyValue}
                      onChange={(e) => update('apiKeyValue', e.target.value)}
                      placeholder="paste token (overrides env var)"
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Response array path</span>
                    <input
                      value={form.responsePath}
                      onChange={(e) => update('responsePath', e.target.value)}
                      placeholder="data.results (optional)"
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Price multiplier</span>
                    <input
                      value={form.priceFactor}
                      onChange={(e) => update('priceFactor', e.target.value)}
                      placeholder="1"
                    />
                  </label>
                </div>
                <div className={styles.formRow}>
                  {([
                    ['fieldId', 'id field', 'id'],
                    ['fieldTitle', 'title field', 'title'],
                    ['fieldPrice', 'price field', 'price'],
                    ['fieldCurrency', 'currency field', 'currency'],
                    ['fieldLocation', 'location field', 'location'],
                    ['fieldImage', 'image field', 'image'],
                    ['fieldUrl', 'URL field', 'url'],
                    ['fieldDescription', 'description field', 'description'],
                    ['fieldPublishedAt', 'published field', 'publishedAt'],
                  ] as [keyof FormState, string, string][]).map(([key, label, placeholder]) => (
                    <label key={key} className={styles.field}>
                      <span>{label}</span>
                      <input
                        value={String(form[key])}
                        onChange={(e) =>
                          setForm((prev) => (prev ? { ...prev, [key]: e.target.value } : prev))
                        }
                        placeholder={placeholder}
                      />
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <div className={styles.subForm}>
                <div className={styles.formRow}>
                  <label className={`${styles.field} ${styles.wide}`}>
                    <span>Executable</span>
                    <input
                      value={form.command}
                      onChange={(e) => update('command', e.target.value)}
                      placeholder="ricardo-scraper"
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Working directory</span>
                    <input value={form.cwd} onChange={(e) => update('cwd', e.target.value)} placeholder="/opt/scraper (optional)" />
                  </label>
                  <label className={styles.field}>
                    <span>Timeout (ms)</span>
                    <input value={form.timeoutMs} onChange={(e) => update('timeoutMs', e.target.value)} placeholder="60000" />
                  </label>
                  <label className={styles.field}>
                    <span>Output file template</span>
                    <input
                      value={form.outputFile}
                      onChange={(e) => update('outputFile', e.target.value)}
                      placeholder="{tmp}.json (optional)"
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Output format</span>
                    <select value={form.format} onChange={(e) => update('format', e.target.value as FormState['format'])}>
                      <option value="auto">Auto</option>
                      <option value="ricardo">Ricardo summary</option>
                    </select>
                  </label>
                </div>
                <label className={styles.field}>
                  <span>Arguments (one per line)</span>
                  <textarea
                    value={form.argsText}
                    onChange={(e) => update('argsText', e.target.value)}
                    rows={5}
                    placeholder={'{query}\n--max-results\n{limit}'}
                  />
                </label>
              </div>
            )}

            <div className={styles.formActions}>
              <button type="button" className={styles.secondaryButton} onClick={cancelForm}>
                Cancel
              </button>
              <button type="button" className={styles.primaryButton} onClick={handleSave} disabled={saving}>
                <Icon name={saving ? 'hourglass_top' : 'save'} size={16} />
                {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Install source'}
              </button>
            </div>
          </div>
        </section>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <h2 className={styles.sectionTitle}>Installed plugins</h2>
            <p className={styles.sectionSub}>
              Folders in <code>{data?.pluginsDir ?? 'plugins/'}</code>. A plugin exports a
              marketplace adapter; a broken one is listed here but never loaded.
            </p>
          </div>
        </div>

        {loadedPlugins === 0 && (data?.plugins.length ?? 0) === 0 ? (
          <div className={styles.emptyPanel}>
            No plugins installed. Drop a folder with <code>plugin.json</code> and an ESM module into{' '}
            <code>{data?.pluginsDir ?? 'plugins/'}</code>, then press “Reload plugins”.
            See <code>plugins.example/</code> for a template.
          </div>
        ) : (
          <div className={styles.customGrid}>
            {data?.plugins.map((plugin) => (
              <article key={plugin.id} className={styles.customCard}>
                <div className={styles.cardTop}>
                  <div className={styles.identity}>
                    <div className={styles.iconBox}>
                      <Icon name={plugin.icon} size={18} />
                    </div>
                    <div className={styles.names}>
                      <span className={styles.cardName}>{plugin.label}</span>
                      <span className={styles.slug}>{plugin.id}</span>
                    </div>
                  </div>
                  <span className={`${styles.statusPill} ${plugin.loaded ? styles.statusOn : styles.statusErr}`}>
                    <span className={styles.statusDot} />
                    {plugin.loaded ? 'loaded' : 'error'}
                  </span>
                </div>
                {plugin.description && <p className={styles.cardDesc}>{plugin.description}</p>}
                <div className={styles.chipRow}>
                  {plugin.markets.length > 0 ? (
                    plugin.markets.map((m) => <span key={m} className={styles.chip}>{m}</span>)
                  ) : (
                    <span className={styles.chip}>all markets</span>
                  )}
                  {plugin.adapterIds.map((id) => (
                    <span key={id} className={styles.chipMuted}>{id}</span>
                  ))}
                </div>
                {plugin.envVars.length > 0 && (
                  <p className={styles.metaLine}>Env: {plugin.envVars.join(', ')}</p>
                )}
                <pre className={styles.install}>{plugin.dir}</pre>
                {plugin.error && (
                  <p className={styles.risk}>
                    <Icon name="error" size={14} />
                    <span>{plugin.error}</span>
                  </p>
                )}
                {plugin.docsUrl && (
                  <div className={styles.cardActions}>
                    <a className={styles.linkButton} href={plugin.docsUrl} target="_blank" rel="noreferrer">
                      <Icon name="open_in_new" size={14} />
                      Plugin docs
                    </a>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
