import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import type { NormalizedListing } from '../lib/types';
import { ListingCard } from './ListingCard';
import { Icon } from './Icon';
import styles from './SavedPage.module.css';

export function SavedPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<NormalizedListing[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    if (!user || !supabase) { setLoading(false); return; }
    supabase
      .from('fundstueck_favorites')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const mapped: NormalizedListing[] = (data ?? []).map((r: any) => ({
          id: r.listing_id,
          source: r.source ?? 'unknown',
          sourceListingId: r.listing_id,
          title: r.title ?? '',
          description: '',
          price: r.price,
          currency: r.currency ?? 'CHF',
          location: null,
          imageUrl: r.image_url,
          listingUrl: r.listing_url ?? '#',
          publishedAt: null,
          fetchedAt: r.created_at,
        }));
        setItems(mapped);
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener('fundstueck:favorite', handler);
    return () => window.removeEventListener('fundstueck:favorite', handler);
  }, [user]);

  if (!user) {
    return (
      <div className={styles.empty}>
        <Icon name="bookmark" size={32} />
        <p>Sign in to save listings.</p>
      </div>
    );
  }
  if (loading) return <div className={styles.empty}>Loading…</div>;
  if (items.length === 0) {
    return (
      <div className={styles.empty}>
        <Icon name="bookmark" size={32} />
        <p>No saved listings yet. Tap the heart on a listing to save it.</p>
      </div>
    );
  }
  return (
    <div className={styles.grid}>
      {items.map((l) => (
        <ListingCard key={l.id} listing={l} view="grid" sourceLabel={l.source} sourceMode="live" />
      ))}
    </div>
  );
}
