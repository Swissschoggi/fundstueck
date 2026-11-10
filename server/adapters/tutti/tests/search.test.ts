import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTuttiAdapter } from '../../tutti.adapter.js';

describe('tutti adapter', () => {
  it('constructs and fixture is present', () => {
    const html = readFileSync(new URL('./fixtures/search.html', import.meta.url), 'utf8');
    const adapter = createTuttiAdapter({
      userAgent: 'test',
      minIntervalMs: 0,
      tutti: true,
      anibis: true,
      ricardo: false,
      regional: true,
      marko: true,
      mercari: false,
      depop: false,
      blocket: false,
      vinted: false,
    } as any);
    assert.equal(adapter.id, 'tutti');
    assert.equal(adapter.markets[0], 'CH');
    assert.ok(html.length > 1000);
  });
});
