/**
 * Normalize an image reference (raw base64, data URI, remote URL, or Buffer)
 * into a raw base64 string suitable for Ollama's /api/generate `images` array.
 */
export async function toBase64Image(input: unknown): Promise<string> {
  if (input instanceof Buffer) {
    return input.toString('base64');
  }
  if (typeof input !== 'string' || input.trim() === '') {
    throw new Error('Image input is empty or invalid.');
  }
  const trimmed = input.trim();
  if (trimmed.startsWith('data:')) {
    const idx = trimmed.indexOf(',');
    if (idx === -1) throw new Error('Invalid data URI: missing comma.');
    const b64 = trimmed.slice(idx + 1);
    if (!b64 || !/^[A-Za-z0-9+/]+=*$/.test(b64)) throw new Error('Invalid base64 in data URI.');
    return b64;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    const res = await fetch(trimmed, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Image HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString('base64');
  }
  // Assume raw base64.
  if (!/^[A-Za-z0-9+/]+=*$/.test(trimmed)) {
    throw new Error('Image data is not valid base64.');
  }
  return trimmed;
}
