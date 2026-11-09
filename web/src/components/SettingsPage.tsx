import { useCallback, useEffect, useState } from 'react';
import {
  checkAdapterHealth,
  fetchEvents,
  fetchRegistryCountry,
  fetchSetup,
  fetchSources,
  fetchSystem,
  saveRegistryEnabled,
  setAdapterEnabled,
} from '../lib/api';
import type { AdapterInfo, RegistryCountryResponse, ServerEvent, SystemInfo } from '../lib/types';
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
  const [runningAll, setRunningAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regionCode, setRegionCode] = useState<string>('CH');
  const [countries, setCountries] = useState<string[]>(['CH']);
  const [registry, setRegistry] = useState<RegistryCountryResponse | null>(null);
  const [registryEnabled, setRegistryEnabled] = useState<string[]>([]);

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
    fetchSetup()
      .then((s) => {
        setRegionCode(s.region || 'CH');
        setCountries(s.countries?.length ? s.countries : [s.region || 'CH']);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!countries.length) return;
    Promise.all(countries.map((c) => fetchRegistryCountry(c)))
      .then((results) => {
        const merged: RegistryCountryResponse = {
          country: results[0].country,
          marketplaces: results.flatMap((r) => r.marketplaces),
          enabled: results[0].enabled || [],
        };
        setRegistry(merged);
        setRegistryEnabled(merged.enabled);
      })
      .catch(() => {});
  }, [countries]);

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

        {adapters.length === 0 && !error ? (
          <div className={styles.emptyPanel}>Loading adapters…</div>
        ) : (
          <>
          <div className={styles.adapterGrid}>
            {adapters.filter((a) => (a.markets?.length ?? 0) <= 3).map((adapter) => (
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
          {adapters.filter((a) => (a.markets?.length ?? 0) > 3).length > 0 && (
            <>
            <h3 className={styles.sectionTitle} style={{ marginTop: 'var(--space-lg)' }}>Global sources</h3>
            <div className={styles.adapterGrid} style={{ marginTop: 'var(--space-sm)' }}>
              {adapters.filter((a) => (a.markets?.length ?? 0) > 3).map((adapter) => (
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
            <h2 className={styles.sectionTitle}>Country &amp; marketplace registry</h2>
            <p className={styles.sectionSub}>
              Countries: {countries.join(', ')}. {registry ? `${registry.marketplaces.length} marketplaces known.` : ''}
              {' '}Manage in <a href="/setup" className={styles.inlineLink}>onboarding</a>.
            </p>
          </div>
        </div>
        {registry ? (
          <div className={styles.registryList}>
            {registry.marketplaces.map((m) => {
              const checked = registryEnabled.includes(m.id);
              const restricted =
                m.automation_permission === 'prohibited_without_authorization' ||
                m.capability.startsWith('D');
              const canInstall = m.adapter_status === 'not_implemented' && m.domain;
              return (
                <div key={m.id} className={styles.registryCard}>
                  <div className={styles.registryCardHead}>
                    <input
                      type="checkbox"
                      disabled={restricted}
                      checked={checked}
                      onChange={async () => {
                        const next = checked
                          ? registryEnabled.filter((x) => x !== m.id)
                          : [...registryEnabled, m.id];
                        setRegistryEnabled(next);
                        try {
                          await saveRegistryEnabled(regionCode, next);
                        } catch {
                          setRegistryEnabled(registryEnabled);
                        }
                      }}
                    />
                    <span className={styles.registryName}>{m.name}</span>
                    <span className={styles.registryDomain}>{m.domain}</span>
                  </div>
                  <div className={styles.registryCardMeta}>
                    <span className={styles.badge} title="Capability">{m.capability.split('/')[0]}</span>
                    <span className={styles.statusBadge}>{m.adapter_status.replace(/_/g, ' ')}</span>
                    {restricted && <span className={styles.restrictedReason}>Restricted</span>}
                    {canInstall && (
                      <button
                        type="button"
                        className={styles.smallButton}
                        onClick={() => onNavigate('/sources')}
                        title="Add this source manually via custom HTTP source"
                      >
                        Add as source
                      </button>
                    )}
                  </div>
                  {m.verification_notes && (
                    <p className={styles.registryNote}>{m.verification_notes}</p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className={styles.emptyPanel}>Loading registry…</div>
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
