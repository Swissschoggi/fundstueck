import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EbayAdapter } from '../../ebay.adapter.js';

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
});
