import { supabase } from './supabase.js';
import type { NormalizedListing } from './types.js';

/**
 * Record prices for a batch of listings and detect price drops.
 * Best-effort: never throws.
 */
export async function recordPrices(listings: NormalizedListing[]): Promise<void> {
  if (!listings.length) return;
  try {
    // Fetch previous prices for these listings
    const ids = [...new Set(listings.map((l) => l.id))];
    const { data: prev } = await supabase
      .from('fundstueck_price_history')
      .select('listing_id, price, recorded_at')
      .in('listing_id', ids)
      .order('recorded_at', { ascending: false });

    const lastPrice = new Map<string, number>();
    for (const r of prev ?? []) {
      if (!lastPrice.has(r.listing_id)) lastPrice.set(r.listing_id, Number(r.price));
    }

    // Insert new price records
    const rows = listings
      .filter((l) => l.price != null)
      .map((l) => ({
        listing_id: l.id,
        source: l.source,
        title: l.title,
        price: l.price,
        currency: l.currency,
      }));
    if (rows.length) {
      await supabase.from('fundstueck_price_history').insert(rows);
    }

    // Detect drops
    const deals: Array<Record<string, unknown>> = [];
    for (const l of listings) {
      if (l.price == null) continue;
      const prevP = lastPrice.get(l.id);
      if (prevP != null && l.price < prevP) {
        const dropPct = ((prevP - l.price) / prevP) * 100;
        deals.push({
          listing_id: l.id,
          source: l.source,
          title: l.title,
          old_price: prevP,
          new_price: l.price,
          currency: l.currency,
          drop_pct: Math.round(dropPct * 10) / 10,
        });
      }
    }
    if (deals.length) {
      await supabase.from('fundstueck_deals').insert(deals);
    }
  } catch (err) {
    // Best-effort: log but don't fail the search
    console.error('[deal-radar] recordPrices failed:', (err as Error).message);
  }
}

export async function fetchDeals(limit = 50): Promise<Array<Record<string, unknown>>> {
  try {
    const { data } = await supabase
      .from('fundstueck_deals')
      .select('*')
      .order('detected_at', { ascending: false })
      .limit(limit);
    return data ?? [];
  } catch {
    return [];
  }
}