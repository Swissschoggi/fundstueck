import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, before, after } from 'node:test';
import { initStorage, closeStorage } from './storage.js';
import { recordPrices, fetchDeals, getPriceHistory, getPriceStats } from './deal-radar.js';
import type { NormalizedListing } from './types.js';

const dataDir = mkdtempSync(path.join(tmpdir(), 'fundstueck-deal-radar-'));

before(async () => {
  await initStorage({ dataDir, databaseUrl: undefined } as never);
});

after(async () => {
  await closeStorage();
  rmSync(dataDir, { recursive: true, force: true });
});

function listing(over: Partial<NormalizedListing>): NormalizedListing {
  return {
    id: 'tutti:1',
    source: 'tutti',
    sourceListingId: '1',
    title: 'Gravel bike',
    description: '',
    price: 500,
    currency: 'CHF',
    location: null,
    imageUrl: null,
    listingUrl: 'https://tutti.ch/listing/1',
    publishedAt: null,
    fetchedAt: new Date().toISOString(),
    ...over,
  };
}

test('recordPrices does not flag a deal on the first sighting of a listing', async () => {
  await recordPrices([listing({ id: 'deal-radar:first', price: 500 })]);
  const deals = await fetchDeals(50);
  assert.equal(deals.find((d) => d.listing_id === 'deal-radar:first'), undefined);
});

test('recordPrices detects a price drop and keeps the original listing URL', async () => {
  const id = 'deal-radar:drop';
  await recordPrices([listing({ id, price: 500, listingUrl: 'https://tutti.ch/listing/42' })]);
  await recordPrices([listing({ id, price: 400, listingUrl: 'https://tutti.ch/listing/42' })]);

  const deals = await fetchDeals(50);
  const deal = deals.find((d) => d.listing_id === id);
  assert.ok(deal, 'expected a deal record for the dropped listing');
  assert.equal(deal!.old_price, 500);
  assert.equal(deal!.new_price, 400);
  assert.equal(deal!.drop_pct, 20);
  // Regression: deal records used to omit listing_url entirely, so the
  // "Open listing" link on the Deal Radar page was always dead.
  assert.equal(deal!.listing_url, 'https://tutti.ch/listing/42');
});

test('recordPrices does not report a deal when the price rises', async () => {
  const id = 'deal-radar:rise';
  await recordPrices([listing({ id, price: 100 })]);
  await recordPrices([listing({ id, price: 150 })]);
  const deals = await fetchDeals(50);
  assert.equal(deals.find((d) => d.listing_id === id), undefined);
});

test('price history and stats accumulate across recordings', async () => {
  const id = 'deal-radar:history';
  await recordPrices([listing({ id, price: 300 })]);
  await recordPrices([listing({ id, price: 250 })]);
  await recordPrices([listing({ id, price: 275 })]);

  const history = await getPriceHistory(id);
  assert.deepEqual(history.map((h) => h.price), [300, 250, 275]);

  const stats = await getPriceStats(id);
  assert.equal(stats.count, 3);
  assert.equal(stats.min, 250);
  assert.equal(stats.max, 300);
  assert.equal(stats.avg, 275);
});
