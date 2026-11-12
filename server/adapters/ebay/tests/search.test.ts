import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EbayAdapter, normalizeEbayItem } from '../../ebay.adapter.js';

describe('ebay adapter', () => {
  it('constructs with correct metadata', () => {
    const adapter = new EbayAdapter({
      clientId: undefined,
      clientSecret: undefined,
      marketplaceId: 'EBAY_CH',
      apiBase: 'https://api.ebay.com',
    } as any);
    assert.equal(adapter.id, 'ebay');
    assert.ok(adapter.markets.includes('CH'));
  });

  it('normalises extended Browse item fields', () => {
    const listing = normalizeEbayItem(
      {
        itemId: '123',
        title: 'Sony WH-1000XM5 Headphones',
        price: { value: '249.90', currency: 'CHF' },
        condition: 'USED_VERY_GOOD',
        image: { imageUrl: 'https://i.ebayimg.com/a.jpg' },
        additionalImages: [
          { imageUrl: 'https://i.ebayimg.com/b.jpg' },
          { imageUrl: 'https://i.ebayimg.com/a.jpg' },
        ],
        itemWebUrl: 'https://www.ebay.ch/itm/123',
        itemCreationDate: '2026-01-01T00:00:00Z',
        itemEndDate: '2026-01-10T00:00:00Z',
        seller: {
          username: 'swiss_seller',
          feedbackPercentage: '99.5',
          feedbackScore: 1234,
          sellerAccountType: 'BUSINESS',
        },
        buyingOptions: ['FIXED_PRICE', 'BEST_OFFER'],
        bidCount: 3,
        shippingOptions: [{ shippingCost: { value: '0', currency: 'CHF' } }],
        categories: [{ categoryName: 'Consumer Electronics' }],
        localizedAspects: [
          { name: 'Brand', value: 'Sony' },
          { name: 'Model', value: 'WH-1000XM5' },
          { name: 'Colour', value: 'Black' },
        ],
        marketingPrice: { originalPrice: { value: '299.00', currency: 'CHF' } },
        itemLocation: { city: 'Zürich', postalCode: '8000', country: 'CH' },
      },
      '2026-02-01T00:00:00Z',
      'CHF',
    );

    assert.equal(listing.id, 'ebay:123');
    assert.equal(listing.price, 249.9);
    assert.equal(listing.condition, 'Used · very good');
    assert.deepEqual(listing.images, [
      'https://i.ebayimg.com/a.jpg',
      'https://i.ebayimg.com/b.jpg',
    ]);
    assert.equal(listing.imageUrl, 'https://i.ebayimg.com/a.jpg');
    assert.equal(listing.location, 'Zürich, 8000, CH');
    assert.equal(listing.category, 'Consumer Electronics');
    assert.equal(listing.brand, 'Sony');
    assert.equal(listing.attributes?.Model, 'WH-1000XM5');
    assert.equal(listing.attributes?.Colour, 'Black');
    assert.deepEqual(listing.buyingOptions, ['Buy it now', 'Best offer']);
    assert.equal(listing.bids, 3);
    assert.equal(listing.endsAt, '2026-01-10T00:00:00Z');
    assert.equal(listing.originalPrice, 299);
    assert.equal(listing.publishedAt, '2026-01-01T00:00:00Z');
    assert.equal(listing.seller?.name, 'swiss_seller');
    assert.equal(listing.seller?.type, 'business');
    assert.equal(listing.seller?.rating, 99.5);
    assert.equal(listing.seller?.feedbackCount, 1234);
    assert.equal(listing.shipping?.cost, 0);
    assert.equal(listing.shipping?.free, true);
  });
});
