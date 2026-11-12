import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { groupDuplicates } from './duplicates.js';
import type { NormalizedListing } from './types.js';

function listing(over: Partial<NormalizedListing> & { id: string; source: string }): NormalizedListing {
  return {
    sourceListingId: over.id,
    title: 'Herman Miller Aeron Chair Size B',
    description: '',
    price: 420,
    currency: 'CHF',
    location: 'Zürich',
    imageUrl: null,
    listingUrl: `https://example.com/${over.id}`,
    publishedAt: null,
    fetchedAt: new Date().toISOString(),
    ...over,
  };
}

describe('groupDuplicates', () => {
  it('merges the same item across two marketplaces by matching title', () => {
    const a = listing({ id: 'ricardo:1', source: 'ricardo', title: 'Herman Miller Aeron Chair Classic Size B' });
    const b = listing({ id: 'tutti:1', source: 'tutti', title: 'Herman Miller Aeron Classic Chair Size B', price: 450 });
    const groups = groupDuplicates([a, b]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].primary.source, 'ricardo');
    assert.equal(groups[0].others.length, 1);
    assert.equal(a.duplicateCount, 1);
    assert.equal(a.duplicateListings?.[0].source, 'tutti');
  });

  it('picks the cheapest listing as primary', () => {
    const a = listing({ id: 'a:1', source: 'a', price: 500 });
    const b = listing({ id: 'b:1', source: 'b', price: 400 });
    const groups = groupDuplicates([a, b]);
    assert.equal(groups[0].primary.price, 400);
    assert.equal(groups[0].primary.source, 'b');
  });

  it('matches identical image URLs regardless of cache-busting query params', () => {
    const a = listing({ id: 'a:1', source: 'a', title: 'Vintage Lamp Brass', imageUrl: 'https://cdn.example.com/img/42.jpg?w=800' });
    const b = listing({ id: 'b:1', source: 'b', title: 'Old brass table light', imageUrl: 'https://cdn.example.com/img/42.jpg?w=1200' });
    const groups = groupDuplicates([a, b]);
    assert.equal(groups.length, 1);
    assert.equal(a.duplicateListings?.[0].matchReason, 'same-image');
  });

  it('does not merge distinct items with weak title overlap', () => {
    const a = listing({ id: 'a:1', source: 'a', title: 'Herman Miller Aeron Chair', price: 400 });
    const b = listing({ id: 'b:1', source: 'b', title: 'Vitra Eames Lounge Chair', price: 2500 });
    const groups = groupDuplicates([a, b]);
    assert.equal(groups.length, 2);
  });

  it('does not merge same-source listings with identical titles but different prices', () => {
    const a = listing({ id: 'a:1', source: 'a', price: 100 });
    const b = listing({ id: 'a:2', source: 'a', price: 900 });
    const groups = groupDuplicates([a, b]);
    assert.equal(groups.length, 2);
  });
});
