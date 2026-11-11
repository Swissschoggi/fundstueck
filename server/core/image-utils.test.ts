import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBase64Image } from './image-utils.js';

const RAW = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aWQAAAAASUVORK5CYII=';

test('toBase64Image: raw base64 passes through', async () => {
  const out = await toBase64Image(RAW);
  assert.equal(out, RAW);
});

test('toBase64Image: data URI strips prefix', async () => {
  const out = await toBase64Image(`data:image/png;base64,${RAW}`);
  assert.equal(out, RAW);
});

test('toBase64Image: Buffer encodes', async () => {
  const buf = Buffer.from('hello');
  const out = await toBase64Image(buf);
  assert.equal(out, buf.toString('base64'));
});

test('toBase64Image: empty throws', async () => {
  await assert.rejects(() => toBase64Image(''), /empty|invalid/i);
});

test('toBase64Image: invalid base64 throws', async () => {
  await assert.rejects(() => toBase64Image('not!!base64'), /valid base64/i);
});

test('toBase64Image: invalid data URI throws', async () => {
  await assert.rejects(() => toBase64Image('data:image/png;base64,'), /invalid base64/i);
});

test('toBase64Image: null throws', async () => {
  await assert.rejects(() => toBase64Image(null), /empty|invalid/i);
});
