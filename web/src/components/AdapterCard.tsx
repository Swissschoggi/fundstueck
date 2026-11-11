import { useEffect, useState } from 'react';
import type { AdapterInfo } from '../lib/types';
import { fetchAdapterConfig, saveAdapterConfig } from '../lib/api';
import { sourceAccent } from '../lib/format';
import { Icon } from './Icon';
import styles from './Settings.module.css';

export interface HealthState {
  state: 'idle' | 'running' | 'done';
  ok?: boolean;
  latencyMs?: number;
  message?: string;
}

export function AdapterCard({
  adapter,
  health,
  toggling,
  onToggle,
  onToggleGlobal,
  onHealthCheck,
  onRemove,
}: {
  adapter: AdapterInfo;
  health: HealthState;
  toggling: boolean;
  /** Personal switch for the signed-in account (or this device). */
  onToggle: (enabled: boolean) => void;
  /** Operator master switch for everyone; needs operator access in production. */
  onToggleGlobal?: (enabled: boolean) => void;
  onHealthCheck: () => void;
  onRemove?: () => void;
}) {
  const [configOpen, setConfigOpen] = useState(false);
  const [cfgValues, setCfgValues] = useState<Record<string, string>>({});
  const [cfgHasSecret, setCfgHasSecret] = useState<Record<string, boolean>>({});
  const [cfgSaving, setCfgSaving] = useState(false);
  const [cfgMsg, setCfgMsg] = useState<string | null>(null);
  const accent = sourceAccent(adapter.source);

  useEffect(() => {
    if (!configOpen || !adapter.configFields?.length) return;
    fetchAdapterConfig(adapter.source)
      .then((r) => {
        setCfgValues(r.values ?? {});
        setCfgHasSecret(r.hasSecret ?? {});
      })
      .catch(() => {});
  }, [configOpen, adapter.source, adapter.configFields]);

  const status = !adapter.configured
    ? { label: adapter.runtimeDisabled ? 'Disabled' : 'Unconfigured', tone: 'muted' as const }
    : adapter.runtimeDisabled
      ? { label: 'Disabled', tone: 'muted' as const }
      : adapter.userEnabled === false
        ? { label: 'Off for you', tone: 'muted' as const }
        : health.state === 'done' && health.ok === false
        ? { label: 'Attention', tone: 'error' as const }
        : health.state === 'done' && health.ok
          ? { label: 'Healthy', tone: 'ok' as const }
          : { label: 'Enabled', tone: 'ok' as const };

  return (
    <article className={styles.adapterCard}>
      <div className={styles.adapterTop}>
        <div className={styles.adapterIdentity}>
          <div className={styles.adapterIcon} style={{ color: accent }}>
            <Icon name={adapter.icon} size={20} />
          </div>
          <div className={styles.adapterNames}>
            <div className={styles.adapterNameRow}>
              <span className={styles.adapterName}>{adapter.label}</span>
              <span className={styles.modeBadge}>
                {adapter.mode === 'live' ? 'Live source' : 'Development data'}
              </span>
            </div>
            <span className={styles.adapterSlug}>
              {adapter.source}_adapter · {adapter.auth}
            </span>
          </div>
        </div>
        <span
          className={`${styles.statusPill} ${
            status.tone === 'ok'
              ? styles.statusOk
              : status.tone === 'error'
                ? styles.statusError
                : styles.statusMuted
          }`}
        >
          <span className={styles.statusDot} />
          {status.label}
        </span>
      </div>

      <p className={styles.adapterDesc}>{adapter.description}</p>

      <div className={styles.metricGrid}>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Latency</span>
          <span className={styles.metricValue}>
            {health.state === 'done' && health.latencyMs != null
              ? `${health.latencyMs} ms`
              : '—'}
          </span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Mode</span>
          <span className={styles.metricValue}>{adapter.mode}</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Credentials</span>
          <span className={styles.metricValue}>
            {adapter.configured ? 'Configured' : 'Missing'}
          </span>
        </div>
      </div>

      <div className={styles.tags}>
        {adapter.capabilities.map((tag) => (
          <span key={tag} className={styles.tag}>
            {tag}
          </span>
        ))}
      </div>

      {health.state === 'done' && (
        <div className={health.ok ? styles.healthOk : styles.healthError}>
          <Icon
            name={health.ok ? 'check_circle' : 'error'}
            size={14}
            style={{ color: health.ok ? '#63e6be' : 'var(--error)' }}
          />
          <span>{health.message}</span>
        </div>
      )}

      <div className={styles.adapterActions}>
        <label
          className={styles.toggle}
          title={
            adapter.configured
              ? 'Toggle whether YOUR searches use this source'
              : (adapter.disabledReason ?? 'Not configured')
          }
        >
          <input
            type="checkbox"
            className={styles.toggleInput}
            checked={adapter.userEnabled ?? adapter.enabled}
            disabled={!adapter.configured || toggling}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <span className={styles.track}>
            <span className={styles.knob} />
          </span>
          <span className={styles.toggleLabel}>Use in my searches</span>
        </label>

        <div className={styles.cardActions}>
          <button
            type="button"
            className={styles.smallButton}
            onClick={() => setConfigOpen((v) => !v)}
            aria-expanded={configOpen}
          >
            <Icon name="tune" size={14} />
            Config
          </button>
          <button
            type="button"
            className={styles.smallButton}
            onClick={onHealthCheck}
            disabled={health.state === 'running'}
          >
            <Icon name="bolt" size={14} />
            {health.state === 'running' ? 'Checking…' : 'Health check'}
          </button>
          {onToggleGlobal && adapter.configured && (
            <button
              type="button"
              className={styles.smallButton}
              onClick={() => onToggleGlobal(adapter.runtimeDisabled)}
              disabled={toggling}
              title="Operator switch: turns this source on or off for all users"
            >
              <Icon name={adapter.runtimeDisabled ? 'play_arrow' : 'pause'} size={14} />
              {adapter.runtimeDisabled ? 'Enable for all' : 'Disable for all'}
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              className={styles.smallButton}
              onClick={onRemove}
              title="Remove this adapter from the installed set"
            >
              <Icon name="delete" size={14} />
              Remove
            </button>
          )}
        </div>
      </div>

      {configOpen && (
        <div className={styles.configPanel}>
          <div className={styles.configRow}>
            <span className={styles.configKey}>Access method</span>
            <span className={styles.configVal}>{adapter.auth}</span>
          </div>
          <div className={styles.configRow}>
            <span className={styles.configKey}>Markets</span>
            <span className={styles.configVal}>
              {adapter.markets.length > 0 ? adapter.markets.join(' · ') : '—'}
            </span>
          </div>
          <div className={styles.configRow}>
            <span className={styles.configKey}>Environment</span>
            <code className={styles.configCode}>{adapter.envVars.join('  ·  ')}</code>
          </div>
          {adapter.disabledReason && (
            <p className={styles.configWarn}>{adapter.disabledReason}</p>
          )}
          {adapter.docsUrl && (
            <a
              className={styles.docsLink}
              href={adapter.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Official API documentation
              <Icon name="north_east" size={13} />
            </a>
          )}
          {adapter.configFields && adapter.configFields.length > 0 && (
            <div className={styles.configForm}>
              {adapter.configFields.map((f) => (
                <label key={f.key} className={styles.configField}>
                  <span className={styles.configKey}>{f.label}</span>
                  <input
                    type={f.secret ? 'password' : 'text'}
                    className={styles.configInput}
                    placeholder={f.secret && cfgHasSecret[f.key] ? '•••• (set) — leave blank to keep' : (f.placeholder ?? '')}
                    value={cfgValues[f.key] ?? ''}
                    onChange={(e) =>
                      setCfgValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                    }
                  />
                  {f.help && <span className={styles.configHelp}>{f.help}</span>}
                </label>
              ))}
              <button
                type="button"
                className={styles.smallButton}
                disabled={cfgSaving}
                onClick={async () => {
                  setCfgSaving(true);
                  setCfgMsg(null);
                  try {
                    await saveAdapterConfig(adapter.source, cfgValues);
                    setCfgMsg('Saved.');
                    const r = await fetchAdapterConfig(adapter.source);
                    setCfgValues(r.values ?? {});
                    setCfgHasSecret(r.hasSecret ?? {});
                  } catch (e) {
                    setCfgMsg(e instanceof Error ? e.message : 'Save failed');
                  } finally {
                    setCfgSaving(false);
                  }
                }}
              >
                {cfgSaving ? 'Saving…' : 'Save config'}
              </button>
              {cfgMsg && <span className={styles.configMsg}>{cfgMsg}</span>}
            </div>
          )}

          <p className={styles.configNote}>
            Enable/disable is persisted to <code>data/adapter-settings.json</code>.
            Credentials are read from environment variables only — never stored here.
          </p>
        </div>
      )}
    </article>
  );
}
