import type { NormalizedListing } from './types.js';

/**
 * Shared, marketplace-agnostic enrichment applied after every adapter has
 * returned. It fills the structured fields that many scrapers do not expose
 * directly (condition, colour, material, brand, dimensions) by reading the
 * title and description, and normalises product images.
 */

const CONDITION_RULES: Array<{ label: string; re: RegExp }> = [
  {
    label: 'For parts',
    re: /\b(defekt|defect(?:ive)?|for parts|ersatzteil(?:e)?|spare parts|bastler|bastelobjekt|non[- ]?functional|nicht funktionsf(?:ä|ae)hig|does ?n[o']?t work|teilespender)\b/i,
  },
  { label: 'New with tags', re: /\b(neu mit etikett|new with tags|nwt|bnwt)\b/i },
  { label: 'New without tags', re: /\b(neu ohne etikett|new without tags|nwot)\b/i },
  {
    label: 'Like new',
    re: /\b(wie neu|neuwertig|like new|as new|mint condition|nearly new|quasi neu)\b/i,
  },
  {
    label: 'Refurbished',
    re: /\b(refurbished|general(?:ü|ue)berholt|revidiert|restauriert|restored)\b/i,
  },
  {
    label: 'New',
    re: /\b(brand ?new|brandneu|neu|new|sealed|versiegelt|unopened|unbenutzt|originalverpackt|ovp)\b/i,
  },
  {
    label: 'Used · very good',
    re: /\b(sehr guter zustand|top ?zustand|top condition|very good|excellent condition)\b/i,
  },
  {
    label: 'Used · good',
    re: /\b(guter zustand|good condition|gut gepflegt)\b/i,
  },
  {
    label: 'Used',
    re: /\b(gebraucht|used|occasions?|second[- ]hand|getragen|worn|gebrauchsspuren|leichte gebrauchsspuren)\b/i,
  },
  { label: 'Vintage', re: /\b(vintage|antik|antique|retro)\b/i },
];

export function inferCondition(text: string): string | null {
  if (!text) return null;
  for (const rule of CONDITION_RULES) {
    if (rule.re.test(text)) return rule.label;
  }
  return null;
}

const COLORS: Array<{ label: string; re: RegExp }> = [
  { label: 'Black', re: /\b(schwarz|black|noir|nero|zwart)\b/i },
  { label: 'White', re: /\b(weiss|wei(?:ß)|white|blanc|bianco|wit)\b/i },
  { label: 'Grey', re: /\b(grau|grey|gray|gris|grigio)\b/i },
  { label: 'Silver', re: /\b(silber|silver|argent|argento)\b/i },
  { label: 'Beige', re: /\b(beige|sand|cream|creme|cr(?:è|e)me)\b/i },
  { label: 'Brown', re: /\b(braun|brown|marron|marrone)\b/i },
  { label: 'Blue', re: /\b(blau|blue|bleu|blu)\b/i },
  { label: 'Green', re: /\b(gr(?:ü|ue)n|green|vert|verde)\b/i },
  { label: 'Red', re: /\b(rot|red|rouge|rosso)\b/i },
  { label: 'Yellow', re: /\b(gelb|yellow|jaune|giallo)\b/i },
  { label: 'Orange', re: /\b(orange|orange)\b/i },
  { label: 'Pink', re: /\b(rosa|pink|rose|rosa)\b/i },
  { label: 'Purple', re: /\b(lila|violett|purple|violet)\b/i },
  { label: 'Gold', re: /\b(gold|golden|dor(?:é|e))\b/i },
  { label: 'Graphite', re: /\b(graphit|graphite)\b/i },
];

const MATERIALS: Array<{ label: string; re: RegExp }> = [
  { label: 'Leather', re: /\b(leder|leather|cuir|pelle)\b/i },
  { label: 'Aluminium', re: /\b(aluminium|aluminum)\b/i },
  { label: 'Stainless steel', re: /\b(edelstahl|stainless steel|inox)\b/i },
  { label: 'Steel', re: /\b(stahl|steel|acier|acciaio)\b/i },
  { label: 'Wood', re: /\b(holz|wood|bois|legno)\b/i },
  { label: 'Fibreglass', re: /\b(fibre de verre|fiberglass|fibreglass|glasfaser)\b/i },
  { label: 'Glass', re: /\b(glas|glass|verre|vetro)\b/i },
  { label: 'Carbon', re: /\b(carbon|karbon)\b/i },
  { label: 'Ceramic', re: /\b(keramik|ceramic|porzellan|porcelain)\b/i },
  { label: 'Wool', re: /\b(wolle|wool|laine|lana)\b/i },
  { label: 'Cotton', re: /\b(baumwolle|cotton|coton|cotone)\b/i },
  { label: 'Silk', re: /\b(seide|silk|soie|seta)\b/i },
  { label: 'Metal', re: /\b(metall|metal|m(?:é|e)tal|metallo)\b/i },
  { label: 'Plastic', re: /\b(plastik|plastic|plastique)\b/i },
  { label: 'Fabric', re: /\b(stoff|fabric|tissu|tessuto)\b/i },
];

/** Brands that show up often enough to be useful; matched case-insensitively. */
const BRANDS = [
  'Herman Miller', 'USM Haller', 'Bang & Olufsen', 'KitchenAid', 'Nespresso',
  'Louis Vuitton', 'Christian Dior', 'Yves Saint Laurent', 'New Balance',
  'North Face', 'Rimowa', 'Vitra', 'Freitag', 'Rolex', 'Omega', 'Tissot',
  'Mondaine', 'Leica', 'Canon', 'Nikon', 'Sony', 'Samsung', 'Apple', 'Lenovo',
  'ThinkPad', 'Dell', 'Asus', 'Acer', 'MSI', 'Razer', 'Microsoft', 'Google',
  'Nintendo', 'PlayStation', 'Xbox', 'Bose', 'Sonos', 'Dyson', 'Philips',
  'Bosch', 'Miele', 'Siemens', 'Electrolux', 'iRobot', 'Roomba', 'Jura',
  'DeLonghi', 'Nike', 'Adidas', 'Puma', 'Patagonia', 'Arc\'teryx', 'Gucci',
  'Prada', 'Chanel', 'Hermes', 'Hermès', 'Burberry', 'Hugo Boss', 'Zara',
  'Uniqlo', 'Levi\'s', 'Shimano', 'SRAM', 'Specialized', 'Trek', 'Scott',
  'Canyon', 'Cube', 'Giant', 'RockShox', 'Fox', 'GoPro', 'DJI',   'Anker', 'Sennheiser', 'Marshall', 'JBL', 'Genelec', 'Teenage Engineering',
];

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const BRAND_MATCHERS = BRANDS.map((brand) => ({
  brand,
  re: new RegExp(`\\b${escapeRe(brand)}\\b`, 'i'),
}));

export function inferBrand(title: string): string | null {
  for (const { brand, re } of BRAND_MATCHERS) {
    if (re.test(title)) return brand;
  }
  return null;
}

function firstColor(text: string): string | null {
  for (const c of COLORS) if (c.re.test(text)) return c.label;
  return null;
}

function firstMaterial(text: string): string | null {
  for (const m of MATERIALS) if (m.re.test(text)) return m.label;
  return null;
}

const DIMENSIONS_RE = /\b\d{1,4}(?:[.,]\d+)?\s*(?:[x×*]\s*\d{1,4}(?:[.,]\d+)?){1,2}\s*(?:cm|mm|m)\b/i;

export function extractAttributes(
  title: string,
  description = '',
): Record<string, string> {
  const text = `${title} ${description}`;
  const attrs: Record<string, string> = {};
  const brand = inferBrand(title);
  if (brand) attrs.Brand = brand;
  const color = firstColor(text);
  if (color) attrs.Colour = color;
  const material = firstMaterial(text);
  if (material) attrs.Material = material;
  const dims = DIMENSIONS_RE.exec(text);
  if (dims) attrs.Dimensions = dims[0].replace(/\s+/g, ' ').trim();
  return attrs;
}

/** Keep valid, absolute, de-duplicated image URLs in their original order. */
export function normalizeImages(
  ...values: Array<string | null | undefined | Array<string | null | undefined>>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const list = Array.isArray(value) ? value : [value];
    for (const item of list) {
      if (typeof item !== 'string') continue;
      const url = item.trim();
      if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

/**
 * Fill derived fields without overwriting anything an adapter already supplied.
 * Mutates and returns the listing for convenient pipeline use.
 */
export function enrichListing(listing: NormalizedListing): NormalizedListing {
  const text = `${listing.title} ${listing.description ?? ''}`;

  if (!listing.condition) {
    const condition = inferCondition(text);
    if (condition) listing.condition = condition;
  }

  const derived = extractAttributes(listing.title, listing.description ?? '');
  if (Object.keys(derived).length > 0) {
    listing.attributes = { ...derived, ...(listing.attributes ?? {}) };
  }

  if (!listing.brand) {
    const brand = listing.attributes?.Brand ?? inferBrand(listing.title);
    if (brand) {
      listing.brand = brand;
      listing.attributes = { Brand: brand, ...(listing.attributes ?? {}) };
    }
  }

  const images = normalizeImages(listing.imageUrl, listing.images ?? []);
  if (images.length > 0) {
    listing.images = images;
    if (!listing.imageUrl) listing.imageUrl = images[0];
  }

  return listing;
}
