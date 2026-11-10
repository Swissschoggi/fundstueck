import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from '../lib/supabase';

interface FavoritesContextValue {
  savedIds: Set<string>;
  isSaved: (id: string) => boolean;
  toggle: (listing: { id: string; source: string; title: string; price: number | null; currency: string; listingUrl: string; imageUrl: string | null }) => Promise<void>;
  refresh: () => Promise<void>;
}

const FavoritesContext = createContext<FavoritesContextValue | undefined>(undefined);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const refresh = async () => {
    if (!user || !supabase) { setSavedIds(new Set()); return; }
    const { data } = await supabase.from('fundstueck_favorites').select('listing_id').eq('user_id', user.id);
    setSavedIds(new Set((data ?? []).map((r: { listing_id: string }) => r.listing_id)));
  };

  useEffect(() => {
    refresh();
  }, [user]);

  const isSaved = (id: string) => savedIds.has(id);

  const toggle = async (listing: { id: string; source: string; title: string; price: number | null; currency: string; listingUrl: string; imageUrl: string | null }) => {
    if (!user) {
      // Not logged in: local-only favorite
      setSavedIds((prev) => {
        const n = new Set(prev);
        if (n.has(listing.id)) n.delete(listing.id); else n.add(listing.id);
        return n;
      });
      window.dispatchEvent(new CustomEvent('fundstueck:favorite', { detail: savedIds.has(listing.id) ? -1 : 1 }));
      return;
    }
    if (!supabase) return;
    if (savedIds.has(listing.id)) {
      await supabase.from('fundstueck_favorites').delete().eq('user_id', user.id).eq('listing_id', listing.id);
      setSavedIds((prev) => { const n = new Set(prev); n.delete(listing.id); return n; });
      window.dispatchEvent(new CustomEvent('fundstueck:favorite', { detail: -1 }));
    } else {
      await supabase.from('fundstueck_favorites').upsert({
        user_id: user.id,
        listing_id: listing.id,
        source: listing.source,
        title: listing.title,
        price: listing.price,
        currency: listing.currency,
        listing_url: listing.listingUrl,
        image_url: listing.imageUrl,
      });
      setSavedIds((prev) => new Set(prev).add(listing.id));
      window.dispatchEvent(new CustomEvent('fundstueck:favorite', { detail: 1 }));
    }
  };

  return (
    <FavoritesContext.Provider value={{ savedIds, isSaved, toggle, refresh }}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error('useFavorites must be used within FavoritesProvider');
  return ctx;
}