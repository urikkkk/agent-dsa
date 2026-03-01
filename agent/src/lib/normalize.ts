/** Parse size string into oz and pack count */
export function parseSize(raw: string): {
  oz: number;
  raw: string;
  pack_count: number;
} {
  if (!raw) return { oz: 0, raw: '', pack_count: 1 };

  const cleaned = raw.toLowerCase().trim();
  let oz = 0;
  let pack_count = 1;

  // Multipacks: "12 x 1.5oz", "12 ct x 1.5 oz"
  const multiMatch = cleaned.match(
    /(\d+)\s*(?:x|ct\s*x|pk\s*x|pack\s*x)\s*(\d+\.?\d*)\s*(?:oz|ounce)/i
  );
  if (multiMatch) {
    pack_count = parseInt(multiMatch[1], 10);
    oz = parseFloat(multiMatch[2]) * pack_count;
    return { oz, raw, pack_count };
  }

  // Count only: "12 ct"
  const ctOnly = cleaned.match(/^(\d+)\s*(?:ct|count|pk|pack|bags?)$/i);
  if (ctOnly) {
    pack_count = parseInt(ctOnly[1], 10);
    return { oz: 0, raw, pack_count };
  }

  // Standard oz: "18 oz", "18.5 ounces"
  const ozMatch = cleaned.match(/(\d+\.?\d*)\s*(?:oz|ounce)/i);
  if (ozMatch) {
    oz = parseFloat(ozMatch[1]);
    return { oz, raw, pack_count };
  }

  // Grams: "510g"
  const gMatch = cleaned.match(/(\d+\.?\d*)\s*(?:g|gram)/i);
  if (gMatch) {
    oz = parseFloat(gMatch[1]) / 28.3495;
    return { oz: Math.round(oz * 100) / 100, raw, pack_count };
  }

  // Pounds: "1.5 lb"
  const lbMatch = cleaned.match(/(\d+\.?\d*)\s*(?:lb|lbs|pound)/i);
  if (lbMatch) {
    oz = parseFloat(lbMatch[1]) * 16;
    return { oz, raw, pack_count };
  }

  return { oz: 0, raw, pack_count };
}

/** Compute unit price ($/oz) */
export function computeUnitPrice(price: number, sizeOz: number): number {
  if (!sizeOz || sizeOz <= 0 || !price || price <= 0) return 0;
  return Math.round((price / sizeOz) * 100) / 100;
}

/** Strip tracking params from URL */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const strip = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
      'ref',
      'clickid',
      'gclid',
      'fbclid',
      'srsltid',
      'adid',
      'wmlspartner',
    ];
    strip.forEach((p) => u.searchParams.delete(p));
    return u.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

/** Extract retailer product ID from URL */
export function extractRetailerProductId(
  url: string,
  domain: string
): string | null {
  try {
    const u = new URL(url);
    if (domain.includes('walmart.com')) {
      const match = u.pathname.match(/\/ip\/(?:[^/]+\/)?(\d+)/);
      return match ? match[1] : null;
    }
    if (domain.includes('target.com')) {
      const match = u.pathname.match(/A-(\d+)/);
      return match ? `A-${match[1]}` : null;
    }
    if (domain.includes('kroger.com')) {
      const match = u.pathname.match(/\/p\/(?:[^/]+\/)?(\d+)/);
      return match ? match[1] : null;
    }
    if (domain.includes('amazon.com')) {
      const match = u.pathname.match(/\/dp\/([A-Z0-9]{10})/);
      return match ? match[1] : null;
    }
    return null;
  } catch {
    return null;
  }
}
