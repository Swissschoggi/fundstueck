import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  enrichListing,
  extractAttributes,
  inferBrand,
  inferCondition,
  normalizeImages,
} from './enrichment.js';
import type { NormalizedListing } from './types.js';

function listing(over: Partial<NormalizedListing>): NormalizedListing {
  return {
    id: 'a:1',
    source: 'a',
    sourceListingId: '1',
    title: '',
    description: '',
    price: 100,
    currency: 'CHF',
    location: null,
    imageUrl: null,
    listingUrl: 'https://example.com/1',
    publishedAt: null,
    fetchedAt: new Date().toISOString(),
    ...over,
  };
}

describe('inferCondition', () => {
  it('recognises German and English condition labels', () => {
    assert.equal(inferCondition('Wie neu, kaum benutzt'), 'Like new');
    assert.equal(inferCondition('Neu, noch originalverpackt'), 'New');
    assert.equal(inferCondition('Defekt, für Bastler'), 'For parts');
    assert.equal(inferCondition('Sehr guter Zustand'), 'Used · very good');
    assert.equal(inferCondition('Guter Zustand, wenig benutzt'), 'Used · good');
    assert.equal(inferCondition('Gebraucht aber gepflegt'), 'Used');
  });

  it('does not treat an inflected "neue" as a new item', () => {
    assert.equal(inferCondition('Gebraucht, neue Batterie eingebaut'), 'Used');
  });

  it('returns null when nothing matches', () => {
    assert.equal(inferCondition('Herman Miller Aeron Chair'), null);
    assert.equal(inferCondition(''), null);
  });
});

describe('extractAttributes', () => {
  it('derives brand, colour, material and dimensions', () => {
    const attrs = extractAttributes(
      'Herman Miller Aeron Chair (Graphite, Grösse B)',
      '75×70cm · Leder · sehr gepflegt',
    );
    assert.equal(attrs.Brand, 'Herman Miller');
    assert.equal(attrs.Colour, 'Graphite');
    assert.equal(attrs.Material, 'Leather');
    assert.equal(attrs.Dimensions, '75×70cm');
  });

  it('prefers brands in the title', () => {
    assert.equal(inferBrand('Apple MacBook Pro 14"'), 'Apple');
    assert.equal(inferBrand('Ein schöner Stuhl'), null);
  });
});

describe('normalizeImages', () => {
  it('keeps valid absolute URLs in order and removes duplicates', () => {
    const images = normalizeImages(
      'https://cdn.example.com/a.jpg',
      ['https://cdn.example.com/b.jpg', 'https://cdn.example.com/a.jpg', '/relative.jpg', null],
    );
    assert.deepEqual(images, [
      'https://cdn.example.com/a.jpg',
      'https://cdn.example.com/b.jpg',
    ]);
  });
});

describe('enrichListing', () => {
  it('fills derived fields without overwriting adapter data', () => {
    const item = listing({
      title: 'Vitra Eames Lounge Chair schwarz',
      description: 'Neuwertig · Leder · 80×85cm',
      condition: 'Seller-supplied',
      imageUrl: 'https://cdn.example.com/main.jpg',
      images: ['https://cdn.example.com/extra.jpg'],
    });
    enrichListing(item);
    assert.equal(item.condition, 'Seller-supplied');
    assert.equal(item.brand, 'Vitra');
    assert.equal(item.attributes?.Colour, 'Black');
    assert.equal(item.attributes?.Material, 'Leather');
    assert.deepEqual(item.images, [
      'https://cdn.example.com/main.jpg',
      'https://cdn.example.com/extra.jpg',
    ]);
  });

  it('sets imageUrl from the first valid image when missing', () => {
    const item = listing({ title: 'Sony PlayStation 5', images: ['https://cdn.example.com/ps5.jpg'] });
    enrichListing(item);
    assert.equal(item.imageUrl, 'https://cdn.example.com/ps5.jpg');
    assert.equal(item.brand, 'Sony');
  });
});
