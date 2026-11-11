import type { NormalizedListing } from '../lib/types';
import { useFavorites } from '../contexts/FavoritesContext';
import { ListingCard } from './ListingCard';
import { Icon } from './Icon';
import styles from './SavedPage.module.css';

export function SavedPage({ imageSearchTemplate, onAiSimilar }: { imageSearchTemplate?: string | null; onAiSimilar?: (listing: NormalizedListing) => void }) {
  const { favorites } = useFavorites();

  const items: NormalizedListing[] = favorites.map((r) => ({
    id: r.id,
    source: r.source ?? 'unknown',
    sourceListingId: r.id,
    title: r.title ?? '',
    description: '',
    price: r.price,
    currency: r.currency ?? 'CHF',
    location: null,
    imageUrl: r.imageUrl,
    listingUrl: r.listingUrl ?? '#',
    publishedAt: null,
    fetchedAt: r.savedAt,
  }));

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
        <ListingCard key={l.id} listing={l} view="grid" sourceLabel={l.source} sourceMode="live" imageSearchTemplate={imageSearchTemplate} onAiSimilar={onAiSimilar} />
      ))}
    </div>
  );
}
