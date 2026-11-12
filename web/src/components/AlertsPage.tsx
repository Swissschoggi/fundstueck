import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AlertRecord,
  AdapterInfo,
  NotificationSettings,
  NotifyChannel,
  SearchWatcher,
} from '../lib/types';
import {
  createWatcher,
  deleteWatcher,
  fetchAlerts,
  fetchNotificationSettings,
  fetchSources,
  fetchWatchers,
  runWatcherNow,
  saveNotificationSettings,
  testNotificationChannels,
  updateWatcher,
  type WatcherDraft,
} from '../lib/api';
import { getDeviceId } from '../lib/device';
import { formatChf, timeAgo } from '../lib/format';
import { Icon } from './Icon';
import styles from './AlertsPage.module.css';

const CHANNELS: { key: NotifyChannel; label: string; icon: string }[] = [
  { key: 'telegram', label: 'Telegram', icon: 'send' },
  { key: 'discord', label: 'Discord', icon: 'forum' },
  { key: 'webhook', label: 'Webhook', icon: 'webhook' },
  { key: 'email', label: 'Email', icon: 'mail' },
];

const EMPTY_SETTINGS: NotificationSettings = {
  telegram: { botToken: '', chatId: '' },
  discord: { webhookUrl: '' },
  webhook: { url: '' },
  email: { address: '' },
};

interface FormState {
  id: string | null;
  label: string;
  query: string;
  market: string;
  maxPrice: string;
  minPrice: string;
  sources: string[];
  notifications: NotifyChannel[];
  highPriority: boolean;
}

function emptyForm(market: string): FormState {
  return {
    id: null,
    label: '',
    query: '',
    market,
    maxPrice: '',
    minPrice: '',
    sources: [],
    notifications: ['telegram', 'webhook'],
    highPriority: false,
  };
}

function formFromWatcher(w: SearchWatcher): FormState {
  return {
    id: w.id,
    label: w.label,
    query: w.query,
    market: w.market,
    maxPrice: w.maxPrice != null ? String(w.maxPrice) : '',
    minPrice: w.minPrice != null ? String(w.minPrice) : '',
    sources: w.sources,
    notifications: w.notifications.length ? w.notifications : ['telegram', 'webhook'],
    highPriority: w.highPriority,
  };
}

function toDraft(form: FormState): WatcherDraft {
  const max = form.maxPrice.trim();
  const min = form.minPrice.trim();
  return {
    label: form.label.trim() || undefined,
    query: form.query.trim(),
    market: form.market,
    maxPrice: max === '' ? null : Number(max),
    minPrice: min === '' ? null : Number(min),
    sources: form.sources,
    notifications: form.notifications,
    highPriority: form.highPriority,
  };
}

export function AlertsPage() {
  const device = getDeviceId();
  const [watchers, setWatchers] = useState<SearchWatcher[]>([]);
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [settings, setSettings] = useState<NotificationSettings>(EMPTY_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [sources, setSources] = useState<AdapterInfo[]>([]);
  const [market] = useState(() => {
    try { return localStorage.getItem('fundstueck.market') || 'CH'; } catch { return 'CH'; }
  });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm(market));
  const [saving, setSaving] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [w, a, s] = await Promise.all([
        fetchWatchers(device),
        fetchAlerts(device, 100),
        fetchNotificationSettings(device),
      ]);
      setWatchers(w);
      setAlerts(a);
      setSettings(s);
      setSettingsLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load alert watchers.');
    } finally {
      setLoading(false);
    }
  }, [device]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    fetchSources(market).then(setSources).catch(() => setSources([]));
  }, [market, modalOpen]);

  const stats = useMemo(() => {
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    const recent = alerts.filter((a) => Date.parse(a.createdAt) >= dayAgo);
    return {
      active: watchers.filter((w) => w.enabled).length,
      total: watchers.length,
      last24h: recent.length,
      newMatches: recent.filter((a) => a.reason === 'new').length,
      priceDrops: recent.filter((a) => a.reason === 'price-drop').length,
    };
  }, [watchers, alerts]);

  const openCreate = () => {
    setForm(emptyForm(market));
    setModalOpen(true);
  };

  const openEdit = (w: SearchWatcher) => {
    setForm(formFromWatcher(w));
    setModalOpen(true);
  };

  const submitForm = async () => {
    if (!form.query.trim()) {
      showToast('Add a search query first.');
      return;
    }
    setSaving(true);
    try {
      if (form.id) {
        const updated = await updateWatcher(device, form.id, toDraft(form));
        setWatchers((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
        showToast('Watcher updated.');
      } else {
        const created = await createWatcher(device, toDraft(form));
        setWatchers((prev) => [created, ...prev]);
        showToast('Watcher deployed. The first run seeds results; new matches will alert.');
      }
      setModalOpen(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save watcher.');
    } finally {
      setSaving(false);
    }
  };

  const toggleWatcher = async (w: SearchWatcher) => {
    setBusyId(w.id);
    try {
      const updated = await updateWatcher(device, w.id, { enabled: !w.enabled });
      setWatchers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not toggle watcher.');
    } finally {
      setBusyId(null);
    }
  };

  const removeWatcher = async (w: SearchWatcher) => {
    if (!window.confirm(`Delete watcher "${w.label}"?`)) return;
    setBusyId(w.id);
    try {
      await deleteWatcher(device, w.id);
      setWatchers((prev) => prev.filter((x) => x.id !== w.id));
      setAlerts((prev) => prev.filter((a) => a.watcherId !== w.id));
      showToast('Watcher deleted.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete watcher.');
    } finally {
      setBusyId(null);
    }
  };

  const runNow = async (w: SearchWatcher) => {
    setBusyId(w.id);
    try {
      const result = await runWatcherNow(device, w.id);
      setWatchers((prev) => prev.map((x) => (x.id === result.watcher.id ? result.watcher : x)));
      if (result.alerts.length) {
        setAlerts((prev) => [...result.alerts, ...prev].slice(0, 100));
        showToast(`${result.alerts.length} alert(s) triggered.`);
      } else if (result.error) {
        showToast(`Ran with issues: ${result.error}`);
      } else {
        showToast('Watcher ran — no new matches.');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not run watcher.');
    } finally {
      setBusyId(null);
    }
  };

  const saveSettings = async () => {
    try {
      const saved = await saveNotificationSettings(device, settings);
      setSettings(saved);
      showToast('Notification channels saved.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save notification channels.');
    }
  };

  const testPipeline = async () => {
    try {
      const { sent } = await testNotificationChannels(device);
      showToast(sent.length ? `Test sent to: ${sent.join(', ')}` : 'No configured channels to test — fill one in below.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Test dispatch failed.');
    }
  };

  const updateForm = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const toggleInArray = <T extends string>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((x) => x !== value) : [...list, value];

  const marketLabel = sources.find((s) => s.markets.includes(market))?.label ?? market;

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroText}>
          <span className={styles.eyebrow}><span className={styles.pulse} /> Alert daemon · background monitoring</span>
          <h1 className={styles.title}>Saved Searches &amp; Alert Radar</h1>
          <p className={styles.subtitle}>
            Watchers re-run your saved searches against every enabled marketplace. New matches and price
            drops are pushed to your notification channels.
          </p>
        </div>
        <div className={styles.heroActions}>
          <button type="button" className={styles.ghostBtn} onClick={testPipeline}>
            <Icon name="send" size={16} /> Test pipeline
          </button>
          <button type="button" className={styles.ghostBtn} onClick={() => void load()}>
            <Icon name="refresh" size={16} /> Refresh
          </button>
          <button type="button" className={styles.primaryBtn} onClick={openCreate}>
            <Icon name="add" size={18} /> Create new watcher
          </button>
        </div>
      </header>

      <div className={styles.stats}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Active watchers</span>
          <span className={styles.statValue}>{stats.active}<small> / {stats.total}</small></span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Alerts (24h)</span>
          <span className={styles.statValue}>{stats.last24h}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>New matches</span>
          <span className={styles.statValue}>{stats.newMatches}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Price drops</span>
          <span className={styles.statValue}>{stats.priceDrops}</span>
        </div>
      </div>

      {error && <div className={styles.errorBox} role="alert">{error}</div>}

      <div className={styles.columns}>
        <section className={styles.mainCol}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Query monitors</h2>
            <span className={styles.countChip}>{watchers.filter((w) => w.enabled).length} running</span>
          </div>

          {loading ? (
            <div className={styles.empty}>Loading watchers…</div>
          ) : watchers.length === 0 ? (
            <div className={styles.empty}>
              <Icon name="notifications_active" size={28} style={{ color: 'var(--outline)' }} />
              <p>No watchers yet. Create one to start receiving matches for a search.</p>
              <button type="button" className={styles.primaryBtn} onClick={openCreate}>
                <Icon name="add" size={16} /> Create new watcher
              </button>
            </div>
          ) : (
            watchers.map((w) => (
              <article key={w.id} className={`${styles.watcher} ${w.enabled ? '' : styles.paused}`}>
                <div className={styles.watcherMain}>
                  <div className={styles.watcherTop}>
                    <span className={`${styles.status} ${w.enabled ? styles.statusActive : ''}`}>
                      <span className={styles.statusDot} />{w.enabled ? 'Active' : 'Paused'}
                    </span>
                    <span className={styles.watcherId}>ID: {w.id}</span>
                    {w.highPriority && <span className={styles.priority}>High priority</span>}
                  </div>
                  <h3 className={styles.watcherTitle}>{w.label}</h3>
                  <p className={styles.watcherQuery}>“{w.query}”</p>
                  <div className={styles.chips}>
                    <span className={styles.chip}><Icon name="payments" size={14} />
                      {w.minPrice != null || w.maxPrice != null
                        ? `CHF ${w.minPrice ?? 0}–${w.maxPrice ?? '∞'}`
                        : 'Any price'}
                    </span>
                    <span className={styles.chip}><Icon name="public" size={14} /> {w.market}</span>
                    <span className={styles.chip}><Icon name="hub" size={14} />
                      {w.sources.length ? `${w.sources.length} source${w.sources.length === 1 ? '' : 's'}` : 'All sources'}
                    </span>
                  </div>
                  <div className={styles.channels}>
                    <span className={styles.channelsLabel}>Pushed to</span>
                    {w.notifications.length === 0 && <span className={styles.chip}>In-app only</span>}
                    {w.notifications.map((c) => {
                      const meta = CHANNELS.find((x) => x.key === c);
                      return <span key={c} className={styles.chip}><Icon name={meta?.icon ?? 'notifications'} size={14} /> {meta?.label ?? c}</span>;
                    })}
                  </div>
                  {w.lastError && <p className={styles.watcherError}><Icon name="error" size={13} /> {w.lastError}</p>}
                </div>
                <div className={styles.watcherSide}>
                  <button
                    type="button"
                    className={`${styles.switch} ${w.enabled ? styles.switchOn : ''}`}
                    role="switch"
                    aria-checked={w.enabled}
                    aria-label={w.enabled ? 'Pause watcher' : 'Enable watcher'}
                    onClick={() => void toggleWatcher(w)}
                    disabled={busyId === w.id}
                  >
                    <span className={styles.switchKnob} />
                  </button>
                  <div className={styles.telemetry}>
                    <span className={styles.telemetryLabel}>Last triggered</span>
                    <span className={styles.telemetryValue}>
                      {w.lastTriggeredAt ? timeAgo(w.lastTriggeredAt) : '—'}
                    </span>
                    <span className={styles.telemetrySub}>
                      {w.lastRunAt ? `checked ${timeAgo(w.lastRunAt)}` : 'not run yet'}
                    </span>
                  </div>
                  <div className={styles.watcherActions}>
                    <button type="button" className={styles.iconBtn} title="Run now" onClick={() => void runNow(w)} disabled={busyId === w.id}>
                      <Icon name="play_arrow" size={18} />
                    </button>
                    <button type="button" className={styles.iconBtn} title="Edit watcher" onClick={() => openEdit(w)}>
                      <Icon name="edit" size={18} />
                    </button>
                    <button type="button" className={`${styles.iconBtn} ${styles.danger}`} title="Delete watcher" onClick={() => void removeWatcher(w)} disabled={busyId === w.id}>
                      <Icon name="delete" size={18} />
                    </button>
                  </div>
                </div>
              </article>
            ))
          )}
        </section>

        <aside className={styles.sideCol}>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.sectionTitle}><Icon name="notifications_active" size={18} /> Notification hub</h2>
            </div>
            <div className={styles.settingsGroup}>
              <label className={styles.field}>
                <span>Telegram bot token</span>
                <input
                  type="password"
                  placeholder="123456:ABC-DEF…"
                  value={settings.telegram.botToken}
                  onChange={(e) => setSettings({ ...settings, telegram: { ...settings.telegram, botToken: e.target.value } })}
                />
              </label>
              <label className={styles.field}>
                <span>Telegram chat ID</span>
                <input
                  type="text"
                  placeholder="8941920"
                  value={settings.telegram.chatId}
                  onChange={(e) => setSettings({ ...settings, telegram: { ...settings.telegram, chatId: e.target.value } })}
                />
              </label>
              <label className={styles.field}>
                <span>Discord webhook URL</span>
                <input
                  type="url"
                  placeholder="https://discord.com/api/webhooks/…"
                  value={settings.discord.webhookUrl}
                  onChange={(e) => setSettings({ ...settings, discord: { webhookUrl: e.target.value } })}
                />
              </label>
              <label className={styles.field}>
                <span>Generic webhook URL</span>
                <input
                  type="url"
                  placeholder="https://homeassistant.local/api/webhook/…"
                  value={settings.webhook.url}
                  onChange={(e) => setSettings({ ...settings, webhook: { url: e.target.value } })}
                />
              </label>
              <label className={styles.field}>
                <span>Email digest (not yet dispatched)</span>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={settings.email.address}
                  onChange={(e) => setSettings({ ...settings, email: { address: e.target.value } })}
                />
              </label>
            </div>
            <div className={styles.panelActions}>
              <button type="button" className={styles.ghostBtn} onClick={testPipeline}>
                <Icon name="send" size={15} /> Send test
              </button>
              <button type="button" className={styles.primaryBtn} onClick={() => void saveSettings()} disabled={!settingsLoaded}>
                Save channels
              </button>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.sectionTitle}><Icon name="bolt" size={18} /> Live alert stream</h2>
              <span className={styles.panelMeta}>{alerts.length} recent</span>
            </div>
            {alerts.length === 0 ? (
              <div className={styles.emptySmall}>No alerts yet. New matches will appear here once watchers run.</div>
            ) : (
              <div className={styles.stream}>
                {alerts.slice(0, 20).map((a) => (
                  <a key={a.id} className={styles.streamItem} href={a.listing.listingUrl} target="_blank" rel="noopener noreferrer">
                    <div className={styles.streamThumb}>
                      {a.listing.imageUrl
                        ? <img src={a.listing.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                        : <Icon name="image" size={20} style={{ color: 'var(--outline-variant)' }} />}
                    </div>
                    <div className={styles.streamBody}>
                      <div className={styles.streamTop}>
                        <span className={styles.streamSource}>{a.listing.source}</span>
                        <span className={styles.streamTime}>{timeAgo(a.createdAt)}</span>
                      </div>
                      <span className={styles.streamTitle}>{a.listing.title}</span>
                      <div className={styles.streamBottom}>
                        <span className={styles.streamPrice}>
                          {a.listing.price != null ? formatChf(a.listing.price, a.listing.currency) : '—'}
                          {a.reason === 'price-drop' && <span className={styles.dropTag}>price drop</span>}
                        </span>
                        {a.listing.location && <span className={styles.streamLocation}>{a.listing.location}</span>}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>

      {modalOpen && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-label={form.id ? 'Edit watcher' : 'Create watcher'} onMouseDown={(e) => { if (e.target === e.currentTarget) setModalOpen(false); }}>
          <div className={styles.modal}>
            <div className={styles.modalHead}>
              <div>
                <h2 className={styles.sectionTitle}>{form.id ? 'Edit query watcher' : 'Create query watcher'}</h2>
                <p className={styles.modalSub}>A background daemon re-runs this search and alerts on new matches.</p>
              </div>
              <button type="button" className={styles.iconBtn} onClick={() => setModalOpen(false)} aria-label="Close">
                <Icon name="close" size={20} />
              </button>
            </div>

            <label className={styles.field}>
              <span>Query keywords</span>
              <input
                type="text"
                placeholder="e.g. Herman Miller Aeron, USM Haller, PS5"
                value={form.query}
                onChange={(e) => updateForm('query', e.target.value)}
              />
            </label>

            <div className={styles.formRow}>
              <label className={styles.field}>
                <span>Label (optional)</span>
                <input type="text" placeholder="Desk chairs" value={form.label} onChange={(e) => updateForm('label', e.target.value)} />
              </label>
              <label className={styles.field}>
                <span>Market</span>
                <input type="text" value={form.market} onChange={(e) => updateForm('market', e.target.value.toUpperCase())} maxLength={2} />
              </label>
            </div>

            <div className={styles.formRow}>
              <label className={styles.field}>
                <span>Min price (CHF)</span>
                <input type="number" min="0" placeholder="0" value={form.minPrice} onChange={(e) => updateForm('minPrice', e.target.value)} />
              </label>
              <label className={styles.field}>
                <span>Max price (CHF)</span>
                <input type="number" min="0" placeholder="850" value={form.maxPrice} onChange={(e) => updateForm('maxPrice', e.target.value)} />
              </label>
            </div>

            <div className={styles.field}>
              <span>Marketplace sources <em>{form.sources.length === 0 ? '(all enabled)' : ''}</em></span>
              <div className={styles.checkRow}>
                {sources.map((s) => (
                  <label key={s.source} className={styles.checkPill}>
                    <input
                      type="checkbox"
                      checked={form.sources.includes(s.source)}
                      onChange={() => updateForm('sources', toggleInArray(form.sources, s.source))}
                    />
                    <span>{s.label}</span>
                  </label>
                ))}
                {sources.length === 0 && <span className={styles.muted}>No sources available for {marketLabel}.</span>}
              </div>
            </div>

            <div className={styles.field}>
              <span>Notify target</span>
              <div className={styles.checkRow}>
                {CHANNELS.map((c) => (
                  <label key={c.key} className={styles.checkPill}>
                    <input
                      type="checkbox"
                      checked={form.notifications.includes(c.key)}
                      onChange={() => updateForm('notifications', toggleInArray(form.notifications, c.key))}
                    />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className={styles.modalActions}>
              <button type="button" className={styles.ghostBtn} onClick={() => setModalOpen(false)}>Cancel</button>
              <button type="button" className={styles.primaryBtn} onClick={() => void submitForm()} disabled={saving}>
                {saving ? 'Saving…' : form.id ? 'Save watcher' : 'Deploy watcher'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={styles.toast} role="status" aria-live="polite"><Icon name="check_circle" size={18} /> {toast}</div>}
    </div>
  );
}
