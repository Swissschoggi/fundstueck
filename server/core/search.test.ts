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

describe('runSearch timeouts', () => {
  const baseListing: NormalizedListing = {
    id: 'slow:1', source: 'slow', sourceListingId: '1', title: 'Test Bike', description: '',
    price: 100, currency: 'CHF', location: null, imageUrl: null,
    listingUrl: 'https://example.com/slow/1', publishedAt: null, fetchedAt: new Date().toISOString(),
  };

  it('passes an AbortSignal that fires at the adapter deadline and reports a timeout', async () => {
    let sawAbort = false;
    const adapter = {
      ...makeAdapter('slow', baseListing),
      timeoutMs: 40,
      search: (params: { signal?: AbortSignal }) =>
        new Promise<NormalizedListing[]>(() => {
          params.signal?.addEventListener('abort', () => { sawAbort = true; });
        }),
    } as unknown as MarketplaceAdapter;
    const res = await runSearch([adapter], parseSearchParams({ q: 'bike', market: 'CH' }));
    assert.equal(sawAbort, true);
    assert.equal(res.sources[0].status, 'timeout');
  });

  it('keeps partial results from an adapter that returns them after the deadline', async () => {
    const adapter = {
      ...makeAdapter('slow', baseListing),
      timeoutMs: 40,
      search: (params: { signal?: AbortSignal }) =>
        new Promise<NormalizedListing[]>((resolve) => {
          params.signal?.addEventListener('abort', () => resolve([baseListing]));
        }),
    } as unknown as MarketplaceAdapter;
    const res = await runSearch([adapter], parseSearchParams({ q: 'bike', market: 'CH' }));
    assert.equal(res.sources[0].status, 'ok');
    assert.equal(res.sources[0].partial, true);
    assert.equal(res.listings.length, 1);
  });

  it('aborts adapters when the caller goes away', async () => {
    let aborted = false;
    const adapter = {
      ...makeAdapter('slow', baseListing),
      search: (params: { signal?: AbortSignal }) =>
        new Promise<NormalizedListing[]>((_, reject) => {
          params.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('cancelled')); });
        }),
    } as unknown as MarketplaceAdapter;
    const caller = new AbortController();
    setTimeout(() => caller.abort(), 20);
    await runSearch([adapter], parseSearchParams({ q: 'bike', market: 'CH' }), { signal: caller.signal });
    assert.equal(aborted, true);
  });
});
