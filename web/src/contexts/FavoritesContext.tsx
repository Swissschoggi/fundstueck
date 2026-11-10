import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { fetchFavorites, saveFavorite, deleteFavorite } from '../lib/api';
import type { StoredFavorite } from '../lib/api';

interface FavoritesContextValue {
  deviceId: string;
  favorites: StoredFavorite[];
  savedIds: Set<string>;
  isSaved: (id: string) => boolean;
  toggle: (listing: { id: string; source: string; title: string; price: number | null; currency: string; listingUrl: string; imageUrl: string | null }) => Promise<void>;
  refresh: () => Promise<void>;
}

const FavoritesContext = createContext<FavoritesContextValue | undefined>(undefined);

function getDeviceId(): string {
  const key = 'fundstueck.deviceId';
  try {
    let id = window.localStorage.getItem(key);
    if (!id) {
      id = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2));
      window.localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return 'anonymous';
  }
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [deviceId] = useState(getDeviceId);
  const [favorites, setFavorites] = useState<StoredFavorite[]>([]);
  const savedIds = new Set(favorites.map((f) => f.id));

  const refresh = async () => {
    try {
      const favs = await fetchFavorites(deviceId);
      setFavorites(favs);
    } catch {
      setFavorites([]);
    }
  };

  useEffect(() => {
    refresh();
  }, [deviceId]);

  const isSaved = (id: string) => savedIds.has(id);

  const toggle = async (listing: { id: string; source: string; title: string; price: number | null; currency: string; listingUrl: string; imageUrl: string | null }) => {
    if (savedIds.has(listing.id)) {
      await deleteFavorite(deviceId, listing.id);
      setFavorites((prev) => prev.filter((f) => f.id !== listing.id));
      window.dispatchEvent(new CustomEvent('fundstueck:favorite', { detail: -1 }));
    } else {
      await saveFavorite(deviceId, {
        id: listing.id,
        source: listing.source,
        title: listing.title,
        price: listing.price,
        currency: listing.currency,
        listingUrl: listing.listingUrl,
        imageUrl: listing.imageUrl,
      });
      const fav: StoredFavorite = {
        id: listing.id,
        source: listing.source,
        title: listing.title,
        price: listing.price,
        currency: listing.currency,
        listingUrl: listing.listingUrl,
        imageUrl: listing.imageUrl,
        savedAt: new Date().toISOString(),
      };
      setFavorites((prev) => [fav, ...prev]);
      window.dispatchEvent(new CustomEvent('fundstueck:favorite', { detail: 1 }));
    }
  };

  return (
    <FavoritesContext.Provider value={{ deviceId, favorites, savedIds, isSaved, toggle, refresh }}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error('useFavorites must be used within FavoritesProvider');
  return ctx;
}
