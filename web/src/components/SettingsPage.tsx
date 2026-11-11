import { useCallback, useEffect, useState } from 'react';
import {
  checkAdapterHealth,
  fetchEvents,
  fetchSources,
  fetchSystem,
  setAdapterEnabled,
  uninstallAdapter,
} from '../lib/api';
import type { AdapterInfo, ServerEvent, SystemInfo } from '../lib/types';
import { AdapterCard, type HealthState } from './AdapterCard';
import { EventTerminal } from './EventTerminal';
import { Icon } from './Icon';
import styles from './Settings.module.css';

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${sec % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

function telemetry(
  icon: string,
  label: string,
  value: string,
  live = false,
) {
  return { icon, label, value, live };
}

export function SettingsPage({ onNavigate }: { onNavigate: (to: string) => void }) {
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [health, setHealth] = useState<Record<string, HealthState>>({});
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [runningAll, setRunningAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageSearchTemplate, setImageSearchTemplate] = useState<string>(() => {
    try { return localStorage.getItem('fundstueck:imageSearchTemplate') ?? ''; } catch { return ''; }
  });

  const refreshEvents = useCallback(() => {
    fetchEvents(120)
      .then(setEvents)
      .catch(() => {});
  }, []);

  const refresh = useCallback(() => {
    Promise.all([fetchSources(), fetchSystem(), fetchEvents(120)])
      .then(([s, sys, ev]) => {
        setAdapters(s);
        setSystem(sys);
        setEvents(ev);
        setError(null);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'Failed to load adapter settings.'),
      );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const id = window.setInterval(() => {
      refreshEvents();
      fetchSystem()
        .then(setSystem)
        .catch(() => {});
    }, 5000);
    return () => window.clearInterval(id);
  }, [refreshEvents]);

  const handleToggle = async (adapter: AdapterInfo, enabled: boolean) => {
    setTogglingId(adapter.source);
    setError(null);
    try {
      const updated = await setAdapterEnabled(adapter.source, enabled);
      setAdapters((prev) => prev.map((a) => (a.source === updated.source ? updated : a)));
      refreshEvents();
      window.dispatchEvent(new CustomEvent('fundstueck:adapters-changed'));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not update adapter.');
    } finally {
      setTogglingId(null);
    }
  };

  const runHealth = useCallback(
    async (id: string) => {
      setHealth((prev) => ({ ...prev, [id]: { state: 'running' } }));
      try {
        const r = await checkAdapterHealth(id);
        setHealth((prev) => ({
          ...prev,
          [id]: { state: 'done', ok: r.ok, latencyMs: r.latencyMs, message: r.message },
        }));
      } catch {
        setHealth((prev) => ({
          ...prev,
          [id]: { state: 'done', ok: false, message: 'Health check request failed.' },
        }));
      }
      refreshEvents();
    },
    [refreshEvents],
  );

  const runAll = async () => {
    setRunningAll(true);
    for (const adapter of adapters) {
      await runHealth(adapter.source);
    }
    setRunningAll(false);
  };

  const handleRemove = async (adapter: AdapterInfo) => {
    if (!window.confirm(`Remove ${adapter.label} from installed adapters? You can install it again later.`)) return;
    setError(null);
    try {
      await uninstallAdapter(adapter.source);
      setAdapters((prev) => prev.filter((a) => a.source !== adapter.source));
      refreshEvents();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove adapter.');
    }
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleAdapters = adapters.filter((a) =>
    !normalizedQuery ||
    a.label.toLowerCase().includes(normalizedQuery) ||
    a.source.toLowerCase().includes(normalizedQuery) ||
    a.markets.some((market) => market.toLowerCase().includes(normalizedQuery)) ||
    a.description.toLowerCase().includes(normalizedQuery),
  );
  const regionalAdapters = visibleAdapters.filter((a) => a.markets.length <= 3);
  const globalAdapters = visibleAdapters.filter((a) => a.markets.length > 3);
  const canRemove = (adapter: AdapterInfo) =>
    adapter.origin === 'built-in' && adapter.source !== 'ebay' && adapter.source !== 'sample' && adapter.markets.length < 50;

  const enabledCount = adapters.filter((a) => a.enabled).length;
  const configuredCount = adapters.filter((a) => a.configured).length;

  const stats = [
    telemetry(
      'hub',
      'Adapter fleet',
      adapters.length > 0 ? `${enabledCount} / ${adapters.length} online` : '—',
      enabledCount > 0,
    ),
    telemetry('memory', 'Engine', 'In-process fan-out'),
    telemetry('developer_board', 'Node heap', system ? `${system.heapUsedMb} MB` : '—'),
    telemetry('speed', 'Uptime', system ? formatUptime(system.uptimeSec) : '—'),
    telemetry('verified_user', 'Compliance', 'APIs + public pages'),
  ];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <div className={styles.breadcrumb}>
            <span>Settings</span>
            <span className={styles.crumbSep}>/</span>
            <span className={styles.crumbAccent}>Crawlers &amp; Daemons</span>
          </div>
          <h1 className={styles.title}>Marketplace Adapters &amp; Source Daemons</h1>
          <p className={styles.subtitle}>
            Built-in marketplace adapters running in-process on this node. Official
            APIs and public server-rendered pages only — Fundstück never solves a
            CAPTCHA itself. Optional operator-installed plugins and custom sources
            are managed on the Source plugins page.
          </p>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => onNavigate('/')}
          >
            <Icon name="arrow_back" size={16} />
            Back to search
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={runAll}
            disabled={runningAll || adapters.length === 0}
          >
            <Icon name="bolt" size={16} />
            {runningAll ? 'Checking sources…' : 'Run all health checks'}
          </button>
        </div>
      </header>

      {error && (
        <div className={styles.errorBanner} role="alert">
          <Icon name="error" size={16} style={{ color: 'var(--error)' }} />
          {error}
        </div>
      )}

      <section className={styles.telemetry}>
        {stats.map((s) => (
          <div key={s.label} className={styles.statCard}>
            <div className={styles.statIcon}>
              <Icon name={s.icon} size={18} style={{ color: 'var(--primary)' }} />
            </div>
            <div className={styles.statBody}>
              <span className={styles.statLabel}>{s.label}</span>
              <span className={styles.statValueRow}>
                {s.live && <span className={styles.statDot} />}
                <span className={styles.statValue}>{s.value}</span>
              </span>
            </div>
          </div>
        ))}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionTitleRow}>
            <h2 className={styles.sectionTitle}>Active adapters</h2>
            <span className={styles.countBadge}>
              {configuredCount} configured · {adapters.length} total
            </span>
          </div>
          <div className={styles.sectionMeta}>
            <Icon name="lock" size={13} />
            Credentials via environment only
          </div>
        </div>

        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search installed adapters by name, country or ID…"
          aria-label="Search installed adapters"
          style={{ width: '100%', maxWidth: 480, marginBottom: 'var(--space-md)', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
        />
        {adapters.length === 0 && !error ? (
          <div className={styles.emptyPanel}>Loading adapters…</div>
        ) : visibleAdapters.length === 0 ? (
          <div className={styles.emptyPanel}>No installed adapters match “{searchQuery}”.</div>
        ) : (
          <>
          <div className={styles.adapterGrid}>
            {regionalAdapters.map((adapter) => (
              <AdapterCard
                key={adapter.source}
                adapter={adapter}
                health={health[adapter.source] ?? { state: 'idle' }}
                toggling={togglingId === adapter.source}
                onToggle={(enabled) => handleToggle(adapter, enabled)}
                onHealthCheck={() => runHealth(adapter.source)}
                onRemove={canRemove(adapter) ? () => handleRemove(adapter) : undefined}
              />
            ))}
          </div>
          {globalAdapters.length > 0 && (
            <>
            <h3 className={styles.sectionTitle} style={{ marginTop: 'var(--space-lg)' }}>Global sources</h3>
            <div className={styles.adapterGrid} style={{ marginTop: 'var(--space-sm)' }}>
              {globalAdapters.map((adapter) => (
                <AdapterCard
                  key={adapter.source}
                  adapter={adapter}
                  health={health[adapter.source] ?? { state: 'idle' }}
                  toggling={togglingId === adapter.source}
                  onToggle={(enabled) => handleToggle(adapter, enabled)}
                  onHealthCheck={() => runHealth(adapter.source)}
                />
              ))}
            </div>
            </>
          )}
          </>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <h2 className={styles.sectionTitle}>Engine &amp; runtime</h2>
            <p className={styles.sectionSub}>
              Live values reported by this node. No simulated telemetry.
            </p>
          </div>
        </div>

        <div className={styles.engineGrid}>
          <div className={styles.engineCard}>
            <div className={styles.engineCardHead}>
              <Icon name="developer_board" size={18} style={{ color: 'var(--primary)' }} />
              <span className={styles.engineTitle}>Node runtime</span>
              <span className={styles.engineBadge}>{system?.env ?? '—'}</span>
            </div>
            <div className={styles.runtimeList}>
              <div className={styles.runtimeRow}>
                <span>Node</span>
                <span className={styles.mono}>{system?.node ?? '—'}</span>
              </div>
              <div className={styles.runtimeRow}>
                <span>Platform</span>
                <span className={styles.mono}>{system?.platform ?? '—'}</span>
              </div>
              <div className={styles.runtimeRow}>
                <span>Uptime</span>
                <span className={styles.mono}>
                  {system ? formatUptime(system.uptimeSec) : '—'}
                </span>
              </div>
              <div className={styles.runtimeRow}>
                <span>Memory</span>
                <span className={styles.mono}>
                  {system ? `${system.heapUsedMb} MB heap · ${system.rssMb} MB RSS` : '—'}
                </span>
              </div>
            </div>
          </div>

          <div className={styles.engineCard}>
            <div className={styles.engineCardHead}>
              <Icon name="hub" size={18} style={{ color: 'var(--primary)' }} />
              <span className={styles.engineTitle}>Search engine</span>
              <span className={styles.engineBadge}>stateless</span>
            </div>
            <div className={styles.runtimeList}>
              <div className={styles.runtimeRow}>
                <span>Fan-out</span>
                <span className={styles.mono}>All enabled sources, concurrent</span>
              </div>
              <div className={styles.runtimeRow}>
                <span>Request timeout</span>
                <span className={styles.mono}>8 s per source</span>
              </div>
              <div className={styles.runtimeRow}>
                <span>Normalisation</span>
                <span className={styles.mono}>Shared listing model + sorting</span>
              </div>
              <div className={styles.runtimeRow}>
                <span>Result cap</span>
                <span className={styles.mono}>100 per search</span>
              </div>
            </div>
            <div className={styles.engineField}>
              <label className={styles.engineLabel} htmlFor="image-search-template">
                Image search URL template
              </label>
              <input
                id="image-search-template"
                className={styles.engineInput}
                placeholder="https://my-ai.example.com/similar?img={image}"
                value={imageSearchTemplate}
                onChange={(e) => setImageSearchTemplate(e.target.value)}
              />
              <p className={styles.engineHint}>
                Use <code>{'{image}'}</code> as the placeholder for the listing image URL.
                Leave empty to use the built-in engines (Google, Yandex, Bing, TinEye).
              </p>
              <button
                type="button"
                className={styles.engineSave}
                onClick={() => {
                  try {
                    if (imageSearchTemplate.trim()) {
                      localStorage.setItem('fundstueck:imageSearchTemplate', imageSearchTemplate.trim());
                    } else {
                      localStorage.removeItem('fundstueck:imageSearchTemplate');
                    }
                    window.dispatchEvent(new Event('fundstueck:imageSearchTemplate'));
                  } catch { /* ignore */ }
                }}
              >
                Save
              </button>
            </div>

            <p className={styles.engineNote}>
              <Icon name="info" size={14} style={{ color: 'var(--outline)' }} />
              Not built yet: local SQLite listing store, cross-source deduplication and
              retention. Those require persistence and are not simulated here.
            </p>
          </div>
        </div>
      </section>

      <EventTerminal events={events} />
    </div>
  );
}
