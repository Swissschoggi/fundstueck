import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  fetchMarkets,
  fetchSearch,
  fetchSetup,
  fetchSources,
} from './lib/api';
import type {
  MarketInfo,
  SearchResponse,
  SetupResponse,
  SortKey,
  SourceInfo,
  ViewMode,
} from './lib/types';
import { Sidebar } from './components/Sidebar';
import { SearchControls } from './components/SearchControls';
import { SourcePills } from './components/SourcePills';
import { FilterRail } from './components/FilterRail';
import { MobileBottomNav } from './components/MobileBottomNav';
import { Results } from './components/Results';
import { SettingsPage } from './components/SettingsPage';
import { SourcesPage } from './components/SourcesPage';
import { Onboarding } from './components/Onboarding';
import styles from './App.module.css';

const SORTS: SortKey[] = ['best', 'newest', 'price_asc', 'price_desc'];
const MARKET_STORAGE_KEY = 'fundstueck.market';

/**
 * Pick the initial market from the URL, then the saved choice, then the
 * browser locale region (never IP-forced). Falls back to the server default.
 */
function initialMarket(): string {
  const fromUrl = new URLSearchParams(window.location.search).get('market');
  if (fromUrl) return fromUrl.toUpperCase();
  try {
    const saved = window.localStorage.getItem(MARKET_STORAGE_KEY);
    if (saved) return saved.toUpperCase();
    const region = navigator.language.split('-')[1];
    if (region && region.length === 2) return region.toUpperCase();
  } catch {
    /* ignore storage access errors */
  }
  return 'CH';
}

type Status = 'idle' | 'loading' | 'success' | 'error';

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [market, setMarket] = useState(initialMarket);
  const [markets, setMarkets] = useState<MarketInfo[]>([]);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [input, setInput] = useState('');
  const [query, setQuery] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [sort, setSort] = useState<SortKey>('newest');
  const [category, setCategory] = useState('');
  const [gender, setGender] = useState('');
  const [view, setView] = useState<ViewMode>('grid');
  const [sourceFilter, setSourceFilter] = useState('all');

  const [pendingMin, setPendingMin] = useState('');
  const [pendingMax, setPendingMax] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [priceError, setPriceError] = useState<string | null>(null);

  const [result, setResult] = useState<SearchResponse | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Region setup decides which built-in sources are installed.
  useEffect(() => {
    fetchSetup()
      .then((s) => {
        setSetup(s);
        const urlMarket = new URLSearchParams(window.location.search).get('market');
        if (!urlMarket) {
          setMarket(s.region);
          try {
            window.localStorage.setItem(MARKET_STORAGE_KEY, s.region);
          } catch {
            /* ignore storage access errors */
          }
        }
      })
      .catch((err: unknown) => {
        setSetupError(
          err instanceof Error ? `Could not load setup: ${err.message}` : 'Could not load setup.',
        );
      });
  }, []);

  // ⌘K / Ctrl-K focuses the search field (as in the design mockup).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Minimal history-API routing (no router dependency needed for two views).
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string) => {
    if (to === window.location.pathname) return;
    window.history.pushState(null, '', to);
    setPath(to);
    window.scrollTo(0, 0);
  }, []);

  // Supported markets + the installed region; correct an unknown saved market.
  useEffect(() => {
    fetchMarkets()
      .then((r) => {
        setMarkets(r.markets);
        setMarket((current) =>
          r.markets.some((m) => m.code === current) ? current : r.region ?? r.default,
        );
      })
      .catch(() => setMarkets([]));
  }, [refreshNonce]);

  const completeSetup = useCallback(
    (next: SetupResponse) => {
      setSetup(next);
      setMarket(next.region);
      setSourceFilter('all');
      try {
        window.localStorage.setItem(MARKET_STORAGE_KEY, next.region);
      } catch {
        /* ignore storage access errors */
      }
      setRefreshNonce((n) => n + 1);
      if (window.location.pathname === '/setup') {
        window.history.pushState(null, '', '/');
        setPath('/');
      }
      window.scrollTo(0, 0);
    },
    [],
  );

  const changeMarket = useCallback((code: string) => {
    setMarket(code);
    try {
      window.localStorage.setItem(MARKET_STORAGE_KEY, code);
    } catch {
      /* ignore storage access errors */
    }
    setSourceFilter('all');
  }, []);

  // Marketplace source metadata for the active market (pills, rail, sidebar).
  // Refetched on navigation so settings toggles are reflected instantly.
  useEffect(() => {
    if (!setup?.complete) return;
    fetchSources(market)
      .then(setSources)
      .catch(() => setSources([]));
  }, [path, market, refreshNonce, setup?.complete]);

  // Restore state from URL so searches are shareable.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const q = p.get('q');
    const s = p.get('sort');
    const mn = p.get('min');
    const mx = p.get('max');
    const g = p.get('gender');
    const v = p.get('view');
    if (v === 'grid' || v === 'list') setView(v);
    if (s && SORTS.includes(s as SortKey)) setSort(s as SortKey);
    if (mn) { setPendingMin(mn); setMinPrice(mn); }
    if (mx) { setPendingMax(mx); setMaxPrice(mx); }
    if (g && ['male','female','unisex'].includes(g)) setGender(g);
    if (q) {
      setInput(q);
      setQuery(q);
    }
  }, []);

  // The single search path: fires whenever query, sort or price filters change.
  useEffect(() => {
    if (query == null) return;
    let cancelled = false;

    setStatus('loading');
    setErrorMessage(null);
    setErrorCode(null);

    fetchSearch({
      q: query,
      market,
      sort,
      minPrice: minPrice !== '' && Number.isFinite(Number(minPrice)) ? Number(minPrice) : null,
      maxPrice: maxPrice !== '' && Number.isFinite(Number(maxPrice)) ? Number(maxPrice) : null,
      category: category || null,
      gender: gender || null,
    })
      .then((r) => {
        if (cancelled) return;
        setResult(r);
        setStatus('success');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : 'Search failed unexpectedly.');
        setErrorCode(err instanceof ApiError ? (err.code ?? null) : null);
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [query, market, sort, minPrice, maxPrice, category, gender, nonce]);

  // Keep the URL shareable: query, sort, view and price filters.
  // Only applies on the search route so settings URLs stay intact.
  useEffect(() => {
    if (query == null || path !== '/') return;
    const p = new URLSearchParams();
    p.set('q', query);
    p.set('market', market);
    p.set('sort', sort);
    p.set('view', view);
    if (minPrice) p.set('min', minPrice);
    if (maxPrice) p.set('max', maxPrice);
    if (gender) p.set('gender', gender);
    window.history.replaceState(null, '', `?${p.toString()}`);
  }, [query, market, sort, view, minPrice, maxPrice, path]);

  const submit = useCallback(() => {
    const q = input.trim();
    if (!q) return;
    setSourceFilter('all');
    setQuery(q);
    setNonce((n) => n + 1);
  }, [input]);

  const applyPrice = useCallback((min: string, max: string) => {
    const mn = min.trim();
    const mx = max.trim();
    const mnNum = mn === '' ? null : Number(mn);
    const mxNum = mx === '' ? null : Number(mx);
    if ((mn !== '' && !Number.isFinite(mnNum)) || (mx !== '' && !Number.isFinite(mxNum))) {
      setPriceError('Enter numeric prices.');
      return;
    }
    if (mnNum != null && mxNum != null && mnNum > mxNum) {
      setPriceError('Min must not exceed max.');
      return;
    }
    setPriceError(null);
    setMinPrice(mn);
    setMaxPrice(mx);
  }, []);

  const resetFilters = useCallback(() => {
    setPendingMin('');
    setPendingMax('');
    setMinPrice('');
    setMaxPrice('');
    setPriceError(null);
    setGender('');
  }, []);

  const counts = useMemo(() => {
    if (!result) return null;
    const map: Record<string, number> = {};
    for (const l of result.listings) map[l.source] = (map[l.source] ?? 0) + 1;
    return map;
  }, [result]);

  const filteredListings = useMemo(() => {
    if (!result) return [];
    if (sourceFilter === 'all') return result.listings;
    return result.listings.filter((l) => l.source === sourceFilter);
  }, [result, sourceFilter]);

  const pillSources =
    sources.length > 0 ? sources.filter((s) => s.enabled) : (result?.sources ?? []);

  const isSources = path.startsWith('/settings/sources');
  const isSettings = path.startsWith('/settings');
  const currentMarket = markets.find((m) => m.code === market);
  const marketLabel = currentMarket?.label ?? market;
  const categories = useMemo(() => {
    if (market !== 'CH') return [];
    return [
      { value: 'fashion-c01000000', label: 'Fashion' },
      { value: 'electronics-c02000000', label: 'Electronics' },
      { value: 'home-c03000000', label: 'Home & Living' },
    ];
  }, [market]);

  if (!setup) {
    return (
      <div className={styles.boot}>
        <div className={styles.bootMark}>
          <span className={styles.bootPulse} />
          Fundstück
        </div>
        <p className={styles.bootText}>{setupError ?? 'Loading sources…'}</p>
      </div>
    );
  }

  if (!setup.complete || path === '/setup') {
    return (
      <Onboarding
        setup={setup}
        onComplete={completeSetup}
        onCancel={
          setup.complete
            ? () => {
                navigate('/');
              }
            : undefined
        }
      />
    );
  }

  const visibleMarkets = markets.filter((m) => m.sources.enabled > 0 || m.code === market);

  return (
    <div className={styles.shell}>
      <Sidebar
        sources={sources}
        latencyMs={result?.tookMs ?? null}
        isSearching={status === 'loading'}
        route={path}
        onNavigate={navigate}
      />

      <div className={styles.content}>
        {isSources ? (
          <SourcesPage onNavigate={navigate} />
        ) : isSettings ? (
          <SettingsPage onNavigate={navigate} />
        ) : (
          <>
            <div className={styles.head}>
              <SearchControls
                ref={inputRef}
                input={input}
                onInputChange={setInput}
                onSubmit={submit}
                market={market}
                markets={visibleMarkets}
                marketLabel={marketLabel}
                onMarketChange={changeMarket}
                sort={sort}
                onSortChange={setSort}
                category={category}
                categories={categories}
                onCategoryChange={setCategory}
                view={view}
                onViewChange={setView}
                isSearching={status === 'loading'}
              />
              {pillSources.length > 0 && (
                <SourcePills
                  sources={pillSources}
                  counts={counts}
                  active={sourceFilter}
                  onChange={setSourceFilter}
                />
              )}
              {priceError && <div className={styles.priceError}>{priceError}</div>}
            </div>

            <div className={styles.workspace}>
              <FilterRail
                minPrice={pendingMin}
                maxPrice={pendingMax}
                onPriceChange={(min, max) => {
                  setPendingMin(min);
                  setPendingMax(max);
                  applyPrice(min, max);
                }}
                onReset={resetFilters}
                sources={sources}
                market={market}
                currency={currentMarket?.currency ?? 'CHF'}
                gender={gender}
                onGenderChange={setGender}
              />
              <Results
                status={status}
                result={result}
                errorMessage={errorMessage}
                errorCode={errorCode}
                marketLabel={marketLabel}
                view={view}
                filteredListings={filteredListings}
                onRetry={() => setNonce((n) => n + 1)}
              />
            </div>
          </>
        )}
      </div>
      <MobileBottomNav
        active={path === '/' ? 'search' : path}
        onNavigate={navigate}
      />
    </div>
  );
}
