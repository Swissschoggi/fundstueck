import { useEffect, useMemo, useState } from 'react';
import { fetchRegistryCountries, fetchRegistryCountry, saveRegistryEnabled, saveSetup } from '../lib/api';
import type { RegistryCountry, RegistryCountryResponse } from '../lib/types';
import { Icon } from './Icon';
import styles from './Onboarding.module.css';

const CONTINENTS: Record<string, string> = {
  CH: 'Europe', DE: 'Europe', AT: 'Europe', FR: 'Europe', IT: 'Europe', ES: 'Europe',
  PT: 'Europe', NL: 'Europe', BE: 'Europe', GB: 'Europe', IE: 'Europe', SE: 'Europe',
  NO: 'Europe', DK: 'Europe', FI: 'Europe', PL: 'Europe', CZ: 'Europe', SK: 'Europe',
  HU: 'Europe', RO: 'Europe', BG: 'Europe', GR: 'Europe', EE: 'Europe', LV: 'Europe',
  LT: 'Europe', HR: 'Europe', RS: 'Europe', SI: 'Europe', BA: 'Europe', AL: 'Europe',
  UA: 'Europe', MD: 'Europe',
  US: 'Americas', CA: 'Americas', MX: 'Americas', BR: 'Americas', AR: 'Americas',
  CL: 'Americas', CO: 'Americas', PE: 'Americas', UY: 'Americas', EC: 'Americas',
  BO: 'Americas', VE: 'Americas',
  JP: 'Asia-Pacific', KR: 'Asia-Pacific', CN: 'Asia-Pacific', TW: 'Asia-Pacific',
  HK: 'Asia-Pacific', SG: 'Asia-Pacific', MY: 'Asia-Pacific', ID: 'Asia-Pacific',
  TH: 'Asia-Pacific', PH: 'Asia-Pacific', VN: 'Asia-Pacific', IN: 'Asia-Pacific',
  PK: 'Asia-Pacific', BD: 'Asia-Pacific', LK: 'Asia-Pacific', AU: 'Oceania',
  NZ: 'Oceania',
  AE: 'Middle East', SA: 'Middle East', JO: 'Middle East', EG: 'Middle East',
  IL: 'Middle East', TR: 'Middle East', IR: 'Middle East',
  ZA: 'Africa', NG: 'Africa', KE: 'Africa', GH: 'Africa', MA: 'Africa',
  DZ: 'Africa', TN: 'Africa',
};

const CAP_LABEL: Record<string, string> = {
  A: 'Official API',
  B: 'Partner API',
  C: 'Public site',
  D: 'Restricted',
  E: 'Unknown',
};

function capabilityLetter(cap: string): string {
  return (cap || 'E').charAt(0).toUpperCase();
}

export function Onboarding({
  setup,
  onComplete,
  onCancel,
}: {
  setup: any;
  onComplete: (next: any) => void;
  onCancel?: () => void;
}) {
  const [countries, setCountries] = useState<RegistryCountry[]>([]);
  const [loadingCountries, setLoadingCountries] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>(setup?.countries?.length ? setup.countries : [setup?.region || 'CH']);
  const [countryData, setCountryData] = useState<RegistryCountryResponse | null>(null);
  const [loadingSources, setLoadingSources] = useState(false);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRegistryCountries()
      .then(setCountries)
      .catch(() => setError('Could not load country catalogue.'))
      .finally(() => setLoadingCountries(false));
  }, []);

  useEffect(() => {
    if (!selected.length) return;
    setLoadingSources(true);
    setCountryData(null);
    Promise.all(selected.map((code) => fetchRegistryCountry(code)))
      .then((results) => {
        const first = results[0];
        const marketplaces = [...new Map(results.flatMap((d) => d.marketplaces).map((m) => [m.id, m])).values()];
        setCountryData({ ...first, marketplaces });
        setEnabled([...new Set(results.flatMap((d) => d.enabled || []))]);
      })
      .catch(() => setError('Could not load sources for the selected countries.'))
      .finally(() => setLoadingSources(false));
  }, [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return countries.filter(
      (c) => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
    );
  }, [countries, query]);

  const grouped = useMemo(() => {
    const groups: Record<string, RegistryCountry[]> = {};
    for (const c of filtered) {
      const g = CONTINENTS[c.code] || 'Other';
      (groups[g] ||= []).push(c);
    }
    return groups;
  }, [filtered]);

  const toggleCountry = (code: string) => {
    setSelected((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  };

  const toggle = (id: string) => {
    setEnabled((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const submit = async () => {
    if (!selected || saving) return;
    setSaving(true);
    setError(null);
    try {
      const primary = selected[0];
      // Save marketplace preferences separately for each selected country.
      const countrySources = await Promise.all(selected.map(async (code) => ({
        code,
        data: await fetchRegistryCountry(code),
      })));
      await Promise.all(countrySources.map(({ code, data }) =>
        saveRegistryEnabled(code, enabled.filter((id) => data.marketplaces.some((m) => m.id === id))),
      ));
      const next = await saveSetup(primary, selected);
      onComplete(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete setup.');
    } finally {
      setSaving(false);
    }
  };

  const selectedCountry = countries.find((c) => c.code === selected[0]);

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
            {setup?.complete ? 'Change country' : 'First-run setup'}
          </span>
          <h1 className={styles.title}>Where should Fundstück search?</h1>
          <p className={styles.subtitle}>
            Pick your countries. Fundstück loads every implemented marketplace adapter available across them and
            honestly reports which ones are actually implemented, restricted or unverified.
            Only implemented, authorized sources can be enabled.
          </p>
        </div>

        {error && (
          <div className={styles.errorBanner} role="alert">
            <Icon name="error" size={16} />
            <span>{error}</span>
          </div>
        )}

        <div className={styles.searchRow}>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search countries…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {loadingCountries ? (
          <div className={styles.emptyPanel}>Loading country catalogue…</div>
        ) : (
          Object.keys(grouped).sort().map((group) => (
            <section key={group} className={styles.group}>
              <div className={styles.groupHead}>
                <h2 className={styles.groupTitle}>{group}</h2>
                <span className={styles.groupCount}>{grouped[group].length}</span>
              </div>
              <div className={styles.grid}>
                {grouped[group].map((c) => {
                  const isSelected = selected.includes(c.code);
                  return (
                    <button
                      key={c.code}
                      type="button"
                      className={`${styles.card} ${isSelected ? styles.selected : ''}`}
                      onClick={() => toggleCountry(c.code)}
                      aria-pressed={isSelected}
                    >
                      <div className={styles.cardTop}>
                        <span className={styles.codeBadge}>{c.flag}</span>
                        <div className={styles.names}>
                          <span className={styles.cardName}>{c.name}</span>
                          <span className={styles.cardMeta}>
                            {c.currency} · {c.default_locale}
                          </span>
                        </div>
                        {isSelected && (
                          <span className={styles.check}>
                            <Icon name="check" size={16} />
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}

        {selectedCountry && (
          <section className={styles.sourceSection}>
            <h2 className={styles.sectionTitle}>
              Sources across {selected.length} selected {selected.length === 1 ? 'country' : 'countries'}
            </h2>
            {loadingSources ? (
              <div className={styles.emptyPanel}>Loading sources…</div>
            ) : countryData ? (
              <>
                <p className={styles.sectionMeta}>
                  {countryData.marketplaces.length} marketplaces · {enabled.length} enabled
                </p>
                <div className={styles.sourceList}>
                  {countryData.marketplaces.map((m) => {
                    const isRestricted =
                      m.automation_permission === 'prohibited_without_authorization' ||
                      m.capability.startsWith('D');
                    const isEligible =
                      !isRestricted &&
                      (m.adapter_status === 'implemented' && m.automation_permission === 'authorized');
                    const checked = enabled.includes(m.id);
                    return (
                      <label
                        key={m.id}
                        className={`${styles.sourceRow} ${isRestricted ? styles.restricted : ''}`}
                      >
                        <input
                          type="checkbox"
                          disabled={!isEligible}
                          checked={checked}
                          onChange={() => toggle(m.id)}
                        />
                        <div className={styles.sourceInfo}>
                          <span className={styles.sourceName}>{m.name}</span>
                          <span className={styles.sourceDomain}>{m.domain}</span>
                        </div>
                        <span className={`${styles.badge} ${styles[`cap_${capabilityLetter(m.capability)}`]}`}>
                          {CAP_LABEL[capabilityLetter(m.capability)] || m.capability}
                        </span>
                        <span className={styles.statusBadge}>{m.adapter_status}</span>
                        {isRestricted && (
                          <span className={styles.restrictedReason}>Restricted — not auto-enabled</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </>
            ) : null}
          </section>
        )}
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerText}>
          <span className={styles.footerLabel}>Selected country</span>
          <span className={styles.footerValue}>
            {selected.length ? `${selected.length} countr${selected.length === 1 ? 'y' : 'ies'} selected` : '—'}
          </span>
        </div>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={submit}
          disabled={saving || !selectedCountry}
        >
          <Icon name={saving ? 'hourglass_top' : 'check'} size={16} />
          {saving ? 'Saving…' : `Continue with ${selected.length} countr${selected.length === 1 ? 'y' : 'ies'}`}
        </button>
      </footer>
    </div>
  );
}
