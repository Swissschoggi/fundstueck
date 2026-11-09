import { useState } from 'react';
import { saveSetup } from '../lib/api';
import type { RegionPack, SetupResponse } from '../lib/types';
import { Icon } from './Icon';
import styles from './Onboarding.module.css';

const GROUPS: RegionPack['group'][] = ['Europe', 'Americas', 'Oceania'];

function counts(pack: RegionPack) {
  return {
    live: pack.sources.filter((s) => s.kind === 'live').length,
    official: pack.sources.filter((s) => s.kind === 'official').length,
    recipes: pack.sources.filter((s) => s.kind === 'recipe').length,
  };
}


export function Onboarding({
  setup,
  onComplete,
  onCancel,
}: {
  setup: SetupResponse;
  onComplete: (next: SetupResponse) => void;
  onCancel?: () => void;
}) {
  const [selected, setSelected] = useState(setup.region);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = setup.regions.find((r) => r.code === selected) ?? setup.regions[0];
  const stats = current ? counts(current) : { live: 0, official: 0, recipes: 0 };

  const submit = async () => {
    if (!current || saving) return;
    setSaving(true);
    setError(null);
    try {
      const next = await saveSetup(current.code);
      onComplete(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not install this region.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.glow} aria-hidden />
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.brandMark}>
            <Icon name="radar" size={18} />
          </div>
          <div>
            <span className={styles.brandName}>Fundstück</span>
            <span className={styles.brandSub}>Meta-Search</span>
          </div>
        </div>
        {onCancel && (
          <button type="button" className={styles.ghostButton} onClick={onCancel}>
            <Icon name="arrow_back" size={16} />
            Back
          </button>
        )}
      </header>

      <main className={styles.main}>
        <div className={styles.intro}>
          <span className={styles.kicker}>
            {setup.complete ? 'Change region' : 'First-run setup'}
          </span>
          <h1 className={styles.title}>Where should Fundstück search?</h1>
          <p className={styles.subtitle}>
            Pick your home region. Only that region&apos;s built-in sources are installed and
            queried — no Swiss scrapers running on a US install, no Italian requests from
            Germany. Custom sources and plugins you add yourself stay available.
          </p>
        </div>

        {error && (
          <div className={styles.errorBanner} role="alert">
            <Icon name="error" size={16} />
            <span>{error}</span>
          </div>
        )}

        {GROUPS.map((group) => {
          const packs = setup.regions.filter((r) => r.group === group);
          if (packs.length === 0) return null;
          return (
            <section key={group} className={styles.group}>
              <div className={styles.groupHead}>
                <h2 className={styles.groupTitle}>{group}</h2>
                <span className={styles.groupCount}>{packs.length} regions</span>
              </div>
              <div className={styles.grid}>
                {packs.map((pack) => {
                  const isSelected = pack.code === selected;
                  const c = counts(pack);
                  return (
                    <button
                      key={pack.code}
                      type="button"
                      className={`${styles.card} ${isSelected ? styles.selected : ''}`}
                      onClick={() => setSelected(pack.code)}
                      aria-pressed={isSelected}
                    >
                      <div className={styles.cardTop}>
                        <span className={styles.codeBadge}>{pack.code}</span>
                        <div className={styles.names}>
                          <span className={styles.cardName}>{pack.label}</span>
                          <span className={styles.cardMeta}>
                            {pack.currency} · {pack.locale}
                          </span>
                        </div>
                        {isSelected && (
                          <span className={styles.check}>
                            <Icon name="check" size={16} />
                          </span>
                        )}
                      </div>
                      <p className={styles.blurb}>{pack.blurb}</p>
                      <div className={styles.chips}>
                        {pack.sources.map((source) => (
                          <span
                            key={source.id}
                            className={`${styles.chip} ${styles[`chip_${source.kind}`]}`}
                            title={source.note}
                          >
                            <span className={styles.chipDot} />
                            {source.label}
                          </span>
                        ))}
                      </div>
                      {pack.note && (
                        <p className={styles.note}>
                          <Icon name="info" size={14} />
                          <span>{pack.note}</span>
                        </p>
                      )}
                      <div className={styles.cardStats}>
                        <span>{c.live} live</span>
                        <span>{c.official} official</span>
                        <span>{c.recipes} optional</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerText}>
          <span className={styles.footerLabel}>Selected region</span>
          <span className={styles.footerValue}>
            {current ? `${current.label} · ${current.currency}` : '—'}
          </span>
          <span className={styles.footerSources}>
            {stats.live} live sources
            {stats.official > 0 ? ` · ${stats.official} official API` : ''}
            {stats.recipes > 0 ? ` · ${stats.recipes} optional recipe` : ''}
          </span>
        </div>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={submit}
          disabled={saving || !current}
        >
          <Icon name={saving ? 'hourglass_top' : 'check'} size={16} />
          {saving ? 'Installing sources…' : `Start with ${current?.label ?? 'this region'}`}
        </button>
      </footer>
    </div>
  );
}
