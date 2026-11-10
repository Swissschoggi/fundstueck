import { readState, writeState } from './storage.js';
import type { NormalizedListing } from './types.js';

interface PriceRecord {
  listing_id: string;
  source: string;
  title: string;
  price: number;
  currency: string;
  recorded_at: string;
}

interface DealRecord {
  listing_id: string;
  source: string;
  title: string;
  old_price: number;
  new_price: number;
  currency: string;
  drop_pct: number;
  detected_at: string;
}

interface DealStore {
  priceHistory: PriceRecord[];
  deals: DealRecord[];
}

let store: DealStore = { priceHistory: [], deals: [] };

async function load(): Promise<void> {
  const parsed = await readState<DealStore>('deal-radar');
  store = parsed && Array.isArray(parsed.priceHistory) ? parsed : { priceHistory: [], deals: [] };
}

async function save(): Promise<void> {
  await writeState('deal-radar', store);
}

export async function recordPrices(listings: NormalizedListing[]): Promise<void> {
  if (!listings.length) return;
  try {
    await load();
    const ids = [...new Set(listings.map((l) => l.id))];
    const lastPrice = new Map<string, number>();
    for (const r of store.priceHistory) {
      if (ids.includes(r.listing_id) && !lastPrice.has(r.listing_id)) {
        lastPrice.set(r.listing_id, Number(r.price));
      }
    }

    const rows: PriceRecord[] = listings
      .filter((l) => l.price != null)
      .map((l) => ({
        listing_id: l.id,
        source: l.source,
        title: l.title,
        price: l.price as number,
        currency: l.currency,
        recorded_at: new Date().toISOString(),
      }));
    if (rows.length) {
      store.priceHistory.push(...rows);
      // keep bounded
      if (store.priceHistory.length > 5000) {
        store.priceHistory = store.priceHistory.slice(-5000);
      }
    }

    const deals: DealRecord[] = [];
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
          detected_at: new Date().toISOString(),
        });
      }
    }
    if (deals.length) {
      store.deals.unshift(...deals);
      if (store.deals.length > 500) store.deals = store.deals.slice(0, 500);
    }
    await save();
  } catch (err) {
    console.error('[deal-radar] recordPrices failed:', (err as Error).message);
  }
}

export async function fetchDeals(limit = 50): Promise<Array<Record<string, unknown>>> {
  try {
    await load();
    return store.deals.slice(0, limit) as unknown as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}
