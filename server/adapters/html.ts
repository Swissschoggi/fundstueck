/** Small HTML helpers shared by the server-rendered page adapters. */

export function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));
}

export function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function firstMatch(block: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(block);
  return match?.[1] != null ? stripTags(match[1]) : undefined;
}

/** Parse a price with German/Austrian formatting (1.399,50 €). */
export function parseGermanPrice(raw: string): number | null {
  const value = raw.replace(/[^\d.,]/g, '').trim();
  if (!value) return null;
  let normalized: string;
  if (value.includes(',')) {
    normalized = value.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(value)) {
    normalized = value.replace(/\./g, '');
  } else {
    normalized = value;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parse a UK price with comma thousands and dot decimals (£1,299.00). */
export function parseUkPrice(raw: string): number | null {
  const value = raw.replace(/[^\d.,]/g, '').trim();
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}
