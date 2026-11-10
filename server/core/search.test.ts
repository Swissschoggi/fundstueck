import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runSearch, parseSearchParams } from './search.js';
import type { MarketplaceAdapter, NormalizedListing } from './types.js';

function makeAdapter(id: string, listing: NormalizedListing): MarketplaceAdapter {
  return {
    id,
    label: id,
    mode: 'live',
    description: '',
    auth: 'test',
    envVars: [],
    capabilities: [],
    icon: 'search',
    markets: ['CH'],
    isEnabled: () => true,
    disabledReason: () => null,
    healthCheck: async () => ({ ok: true, latencyMs: 0, message: 'ok' }),
    search: async () => [listing],
  };
}

describe('runSearch dedup contract', () => {
  it('populates rawTotal and duplicatesRemoved', async () => {
    const listing: NormalizedListing = {
      id: 'a:1',
      source: 'a',
      sourceListingId: '1',
      title: 'Test Bike',
      description: '',
      price: 100,
      currency: 'CHF',
      location: 'Zurich',
      imageUrl: null,
      listingUrl: 'https://example.com/item/1',
      publishedAt: null,
      fetchedAt: new Date().toISOString(),
    };
    const dup = { ...listing, id: 'b:2', source: 'b', sourceListingId: '2' };
    const adapters = [makeAdapter('a', listing), makeAdapter('b', dup)];
    const query = parseSearchParams({ q: 'bike', market: 'CH' });
    const res = await runSearch(adapters, query);
    assert.equal(res.rawTotal, 2);
    assert.equal(res.duplicatesRemoved, 1);
    assert.equal(res.listings.length, 1);
  });
});
