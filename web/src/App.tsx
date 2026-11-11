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
import { MobileBottomNav } from './components/MobileBottomNav';
import { SearchControls } from './components/SearchControls';
import { FilterRail } from './components/FilterRail';
import { Icon } from './components/Icon';
import { useAuth } from './contexts/AuthContext';
import { useFavorites } from './contexts/FavoritesContext';
import { AuthModal } from './components/AuthModal';
import { Results } from './components/Results';
import { SettingsPage } from './components/SettingsPage';
import { SavedPage } from './components/SavedPage';
import { DealRadarPage } from './components/DealRadarPage';
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
  const [size, setSize] = useState('');
  const [view, setView] = useState<ViewMode>('grid');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [hidePriceless, setHidePriceless] = useState(false);
  const [visibleCount, setVisibleCount] = useState(48);
  const [imageSearchTemplate, setImageSearchTemplate] = useState<string | null>(null);
  const [aiBusyId, setAiBusyId] = useState<string | null>(null);
  const { user, signOut } = useAuth();


  useEffect(() => {
    const apply = () => {
      try {
        const stored = localStorage.getItem('fundstueck:imageSearchTemplate');
        if (stored) { setImageSearchTemplate(stored); return; }
      } catch { /* ignore */ }
      fetch('/api/image-search').then((r) => r.ok ? r.json() : null).then((b) => {
        if (b?.template) setImageSearchTemplate(b.template);
      }).catch(() => {});
    };
    apply();
    const handler = () => apply();
    window.addEventListener('fundstueck:imageSearchTemplate', handler);
    return () => window.removeEventListener('fundstueck:imageSearchTemplate', handler);
  }, []);
  const { savedIds } = useFavorites();
  const [authOpen, setAuthOpen] = useState(false);

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

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail === 'string' && detail.trim()) {
        setInput(detail);
        setQuery(detail);
      }
    };
    window.addEventListener('fundstueck:suggest', handler);
    return () => window.removeEventListener('fundstueck:suggest', handler);
  }, []);

  // Minimal history-API routing (no router dependency needed for two views).
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string) => {
    if (to === '/') {
      setInput('');
      setQuery(null);
      setResult(null);
      setStatus('idle');
    }
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

  // Marketplace source metadata for the active market (pills, rail, sidebar).
  // Refetched on navigation or when adapters are toggled in settings.
  useEffect(() => {
    if (!setup?.complete) return;
    fetchSources(market)
      .then(setSources)
      .catch(() => setSources([]));
  }, [path, market, refreshNonce, setup?.complete]);

  useEffect(() => {
    const handler = () => setRefreshNonce((n) => n + 1);
    window.addEventListener('fundstueck:adapters-changed', handler);
    return () => window.removeEventListener('fundstueck:adapters-changed', handler);
  }, []);

  // Restore state from URL so searches are shareable.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const q = p.get('q');
    const s = p.get('sort');
    const mn = p.get('min');
    const mx = p.get('max');
    const g = p.get('gender');
    const z = p.get('size');
    const v = p.get('view');
    if (v === 'grid' || v === 'list') setView(v);
    if (s && SORTS.includes(s as SortKey)) setSort(s as SortKey);
    if (mn) { setPendingMin(mn); setMinPrice(mn); }
    if (mx) { setPendingMax(mx); setMaxPrice(mx); }
    if (g && ['male','female','unisex'].includes(g)) setGender(g);
    if (z) setSize(z);
    if (q) {
      setInput(q);
      setQuery(q);
    }
  }, []);

  // The single search path: fires whenever query, sort or price filters change.
  useEffect(() => {
    if (query == null) return;
    const controller = new AbortController();

    setStatus('loading');
    setErrorMessage(null);
    setErrorCode(null);

    fetchSearch(
      {
        q: query,
        market,
        sort: 'best',
        minPrice: minPrice !== '' && Number.isFinite(Number(minPrice)) ? Number(minPrice) : null,
        maxPrice: maxPrice !== '' && Number.isFinite(Number(maxPrice)) ? Number(maxPrice) : null,
        category: category || null,
        gender: gender || null,
        size: size.trim() || null,
      },
      controller.signal,
    )
      .then((r) => {
        setResult(r);
        setVisibleCount(48);
        setStatus('success');
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setErrorMessage(err instanceof Error ? err.message : 'Search failed unexpectedly.');
        setErrorCode(err instanceof ApiError ? (err.code ?? null) : null);
        setStatus('error');
      });

    return () => {
      controller.abort();
    };
  }, [query, market, minPrice, maxPrice, category, gender, size, nonce, path]);

  // Keep the URL shareable: query, sort, view and price filters.
  // Only applies on the search route so settings URLs stay intact.
  useEffect(() => {
    if (path !== '/') return;
    const p = new URLSearchParams();
    if (query) p.set('q', query);
    p.set('market', market);
    p.set('sort', sort);
    p.set('view', view);
    if (minPrice) p.set('min', minPrice);
    if (maxPrice) p.set('max', maxPrice);
    if (gender) p.set('gender', gender);
    if (size) p.set('size', size);
    const qs = p.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [query, market, sort, view, minPrice, maxPrice, gender, size, path]);

  const submit = useCallback((qOverride?: string) => {
    const q = (qOverride ?? input).trim();
    if (!q) return;
    if (qOverride) setInput(q);
    setSourceFilter('all');
    try {
      const prev = JSON.parse(localStorage.getItem('fundstueck:recent') || '[]');
      const next = [q, ...prev.filter((x: string) => x !== q)].slice(0, 8);
      localStorage.setItem('fundstueck:recent', JSON.stringify(next));
    } catch { /* ignore */ }
    setQuery(q);
    setNonce((n) => n + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [input]);

  const runAiSimilar = useCallback(async (listing: { title: string; imageUrl?: string | null; id?: string }) => {
    setAiBusyId(listing.id ?? null);
    let cfg: { endpoint: string; model: string; apiKey: string } | null = null;
    try {
      const raw = localStorage.getItem('fundstueck:aiConfig');
      if (raw) cfg = JSON.parse(raw);
    } catch { /* ignore */ }
    if (!cfg?.endpoint || !cfg?.model || !listing.imageUrl) return;
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: cfg.endpoint,
          model: cfg.model,
          apiKey: cfg.apiKey,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'You are a shopping search assistant. Look at the product image and output 3 to 5 concise keywords a buyer would type into a marketplace search (item type, color, brand, material, style). Output ONLY the keywords separated by single spaces. No sentences, no descriptions, no punctuation, no articles.' },
              { type: 'image_url', image_url: { url: listing.imageUrl } },
            ],
          }],
          max_tokens: 30,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        const msg = body?.error?.message ?? body?.error ?? `AI request failed (${res.status})`;
        window.alert(`AI failed: ${msg}`);
        return;
      }
      const raw = body?.choices?.[0]?.message?.content?.trim() ?? '';
      const filler = new Set(['the','image','shows','a','an','of','with','and','is','this','pair','in']);
      const text = raw.replace(/[^a-zA-Z0-9äöüÄÖÜéèàç ]/g, ' ').split(/\s+/).filter((w: string) => w && !filler.has(w.toLowerCase())).slice(0, 6).join(' ');
      if (text) {
        navigate('/');
        setTimeout(() => submit(text), 0);
      }
      else window.alert('AI returned no description.');
    } catch (err) {
      window.alert(`AI failed: ${err instanceof Error ? err.message : 'network error'}`);
    }
    finally { setAiBusyId(null); }
  }, [submit, navigate]);

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
    setSize('');
  }, []);

  const filteredListings = useMemo(() => {
    if (!result) return [];
    let out = [...result.listings];
    if (sourceFilter !== 'all') out = out.filter((l) => l.source === sourceFilter);
    if (hidePriceless) out = out.filter((l) => l.price != null);
    const effectivePrice = (l: (typeof out)[number]) => l.price ?? Infinity;
    switch (sort) {
      case 'price_asc':
        out.sort((a, b) => effectivePrice(a) - effectivePrice(b));
        break;
      case 'price_desc':
        out.sort((a, b) => effectivePrice(b) - effectivePrice(a));
        break;
      case 'newest':
        out.sort((a, b) => {
          const ta = a.publishedAt ? Date.parse(a.publishedAt) : a.fetchedAt ? Date.parse(a.fetchedAt) : 0;
          const tb = b.publishedAt ? Date.parse(b.publishedAt) : b.fetchedAt ? Date.parse(b.fetchedAt) : 0;
          return tb - ta;
        });
        break;
      default:
        break;
    }
    return out;
  }, [result, sourceFilter, hidePriceless, sort]);
  const visibleListings = useMemo(() => filteredListings.slice(0, visibleCount), [filteredListings, visibleCount]);

  // Once a search has run, show the adapters that actually participated in it.
  // The installed-source metadata can lag behind dynamically loaded adapters.
  const isSources = path.startsWith('/settings/sources');
  const isSettings = path.startsWith('/settings');
  const isSaved = path === '/saved';
  const isDeals = path === '/deals' || path === '/deal-radar';
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

  return (
    <div className={styles.shell}>
      <Sidebar
        sources={sources}
        latencyMs={result?.tookMs ?? null}
        isSearching={status === 'loading'}
        route={path}
        onNavigate={navigate}
      />

      {aiBusyId && (
        <div className={styles.aiToast} role="status" aria-live="polite">
          <span className={styles.aiSpinner} /> Finding similar image…
        </div>
      )}
      <div className={styles.content}>
        {isSources ? (
          <SourcesPage onNavigate={navigate} />
        ) : isSettings ? (
          <SettingsPage onNavigate={navigate} />
        ) : isSaved ? (
          <SavedPage imageSearchTemplate={imageSearchTemplate} onAiSimilar={runAiSimilar} />
        ) : isDeals ? (
          <DealRadarPage />
        ) : (
          <>
            <div className={styles.head}>
              <div className={styles.headTop}>
                <div className={styles.statusBadge}>
                  <span className={styles.statusDot} />
                  {sources.filter((s) => s.userEnabled ?? s.enabled).length} sources active · live search
                </div>
                <button
                  type="button"
                  className={styles.accountBtn}
                  onClick={() => (user ? signOut() : setAuthOpen(true))}
                >
                  <Icon name={user ? 'logout' : 'person'} size={16} />
                  <span>{user ? (user.email ?? 'Account') : 'Sign in'}</span>
                </button>
              </div>
              <SearchControls
                ref={inputRef}
                input={input}
                onInputChange={setInput}
                onSubmit={submit}
                onClear={() => { setInput(''); setQuery(null); setResult(null); setStatus('idle'); }}
                sort={sort}
                onSortChange={setSort}
                category={category}
                categories={categories}
                onCategoryChange={setCategory}
                view={view}
                onViewChange={setView}
                isSearching={status === 'loading'}
                sourceFilter={sourceFilter}
                onSourceFilterChange={setSourceFilter}
                hidePriceless={hidePriceless}
                onHidePricelessChange={setHidePriceless}
                sources={sources}
                minPrice={pendingMin}
                maxPrice={pendingMax}
                onPriceChange={(min, max) => {
                  setPendingMin(min);
                  setPendingMax(max);
                  applyPrice(min, max);
                }}
                currency={currentMarket?.currency ?? 'CHF'}
                gender={gender}
                onGenderChange={setGender}
                size={size}
                onSizeChange={setSize}
              />
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
                size={size}
                onSizeChange={setSize}
                sourceFilter={sourceFilter}
                onSourceFilterChange={setSourceFilter}
                hidePriceless={hidePriceless}
                onHidePricelessChange={setHidePriceless}
              />
              <Results
                status={status}
                result={result}
                errorMessage={errorMessage}
                errorCode={errorCode}
                marketLabel={marketLabel}
                view={view}
                filteredListings={visibleListings}
                hasMore={visibleCount < filteredListings.length}
                onLoadMore={() => setVisibleCount((n) => n + 48)}
                imageSearchTemplate={imageSearchTemplate}
                onAiSimilar={runAiSimilar}
                aiBusyId={aiBusyId}
                onRetry={() => setNonce((n) => n + 1)}
              />
            </div>
          </>
        )}
      </div>
      <MobileBottomNav
        active={path === '/' ? 'search' : path}
        onNavigate={navigate}
        savedCount={savedIds.size}
      />
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}
