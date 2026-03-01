import { describe, it, expect } from 'vitest';
import { parseSize, computeUnitPrice, normalizeUrl, extractRetailerProductId } from './normalize.js';

describe('parseSize', () => {
  it('parses standard oz', () => {
    expect(parseSize('18 oz')).toEqual({ oz: 18, raw: '18 oz', pack_count: 1 });
  });

  it('parses decimal oz', () => {
    expect(parseSize('18.5 ounces')).toEqual({ oz: 18.5, raw: '18.5 ounces', pack_count: 1 });
  });

  it('parses multipacks', () => {
    const result = parseSize('12 x 1.5oz');
    expect(result.pack_count).toBe(12);
    expect(result.oz).toBe(18);
  });

  it('parses ct-only packs', () => {
    expect(parseSize('12 ct')).toEqual({ oz: 0, raw: '12 ct', pack_count: 12 });
  });

  it('parses grams to oz', () => {
    const result = parseSize('510g');
    expect(result.oz).toBeCloseTo(17.99, 1);
    expect(result.pack_count).toBe(1);
  });

  it('parses pounds to oz', () => {
    expect(parseSize('1.5 lb')).toEqual({ oz: 24, raw: '1.5 lb', pack_count: 1 });
  });

  it('returns zero for empty string', () => {
    expect(parseSize('')).toEqual({ oz: 0, raw: '', pack_count: 1 });
  });

  it('returns zero for unparseable string', () => {
    expect(parseSize('large box')).toEqual({ oz: 0, raw: 'large box', pack_count: 1 });
  });

  it('handles "pack x oz" format', () => {
    const result = parseSize('6 pk x 2.5 oz');
    expect(result.pack_count).toBe(6);
    expect(result.oz).toBe(15);
  });
});

describe('computeUnitPrice', () => {
  it('computes price per oz', () => {
    expect(computeUnitPrice(5.99, 18)).toBe(0.33);
  });

  it('returns 0 for zero size', () => {
    expect(computeUnitPrice(5.99, 0)).toBe(0);
  });

  it('returns 0 for zero price', () => {
    expect(computeUnitPrice(0, 18)).toBe(0);
  });

  it('returns 0 for negative values', () => {
    expect(computeUnitPrice(-1, 18)).toBe(0);
    expect(computeUnitPrice(5.99, -1)).toBe(0);
  });
});

describe('normalizeUrl', () => {
  it('strips tracking params', () => {
    expect(normalizeUrl('https://example.com/product?id=1&utm_source=google&ref=abc'))
      .toBe('https://example.com/product?id=1');
  });

  it('removes trailing slash', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
  });

  it('returns original for invalid URL', () => {
    expect(normalizeUrl('not-a-url')).toBe('not-a-url');
  });
});

describe('extractRetailerProductId', () => {
  it('extracts Amazon ASIN', () => {
    expect(extractRetailerProductId('https://www.amazon.com/dp/B08N5WRWNW', 'amazon.com'))
      .toBe('B08N5WRWNW');
  });

  it('extracts Walmart product ID', () => {
    expect(extractRetailerProductId('https://www.walmart.com/ip/Cheerios/12345', 'walmart.com'))
      .toBe('12345');
  });

  it('extracts Target TCIN', () => {
    expect(extractRetailerProductId('https://www.target.com/p/cheerios-A-12345', 'target.com'))
      .toBe('A-12345');
  });

  it('returns null for unknown domain', () => {
    expect(extractRetailerProductId('https://example.com/product/123', 'example.com'))
      .toBeNull();
  });
});
