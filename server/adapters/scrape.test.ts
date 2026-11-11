import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PoliteClient, combineSignals } from './scrape.js';
import { SourceError } from '../core/types.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function client(over: Partial<ConstructorParameters<typeof PoliteClient>[0]> = {}) {
  return new PoliteClient({
    source: 'Test',
    userAgent: 'test',
    minIntervalMs: 0,
    jitterMs: 0,
    cacheTtlMs: 0,
    ...over,
  });
}

describe('PoliteClient', () => {
  it('shares one upstream fetch between concurrent identical requests', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 30));
      return new Response('<html>ok</html>', { status: 200 });
    }) as typeof fetch;
    const c = client();
    const [a, b, d] = await Promise.all([
      c.getHtml('https://x.test/a'),
      c.getHtml('https://x.test/a'),
      c.getHtml('https://x.test/a'),
    ]);
    assert.equal(calls, 1);
    assert.equal(a, b);
    assert.equal(b, d);
  });

  it('stops waiting as soon as the caller aborts', async () => {
    globalThis.fetch = (async () => {
      await new Promise((r) => setTimeout(r, 2000));
      return new Response('late', { status: 200 });
    }) as typeof fetch;
    const c = client();
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 30);
    const t0 = Date.now();
    await assert.rejects(c.getHtml('https://x.test/slow', { signal: ctl.signal }), SourceError);
    assert.ok(Date.now() - t0 < 500, 'should reject long before the slow fetch finishes');
  });

  it('one caller aborting does not cancel the shared fetch for others', async () => {
    globalThis.fetch = (async () => {
      await new Promise((r) => setTimeout(r, 80));
      return new Response('shared', { status: 200 });
    }) as typeof fetch;
    const c = client();
    const ctl = new AbortController();
    const first = c.getHtml('https://x.test/s', { signal: ctl.signal });
    const second = c.getHtml('https://x.test/s');
    setTimeout(() => ctl.abort(), 10);
    await assert.rejects(first, SourceError);
    assert.equal(await second, 'shared');
  });

  it('fails fast with a busy error instead of queueing past maxQueueMs', async () => {
    globalThis.fetch = (async () => new Response('ok', { status: 200 })) as typeof fetch;
    const c = client({ minIntervalMs: 60_000, maxQueueMs: 50 });
    await c.getHtml('https://x.test/1'); // takes the slot
    await assert.rejects(c.getHtml('https://x.test/2'), /busy/);
  });
});

describe('combineSignals', () => {
  it('aborts when any input aborts', () => {
    const a = new AbortController();
    const b = new AbortController();
    const s = combineSignals(a.signal, b.signal);
    assert.equal(s.aborted, false);
    b.abort();
    assert.equal(s.aborted, true);
  });
});
