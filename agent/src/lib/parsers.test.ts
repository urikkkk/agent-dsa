import { describe, it, expect } from 'vitest';
import { parseSerpResults, parsePdpResult, pdpToProduct } from './parsers.js';

describe('parseSerpResults', () => {
  it('returns empty array for null input', () => {
    expect(parseSerpResults(null)).toEqual([]);
  });

  it('returns empty array for non-array input', () => {
    expect(parseSerpResults({ data: 'not an array' })).toEqual([]);
  });

  it('parses WSA-style SERP items', () => {
    const raw = [
      {
        product_name: 'Cheerios',
        position: 1,
        product_url: 'https://www.amazon.com/dp/B123',
        price: 4.99,
        is_sponsored: false,
        asin: 'B123',
        rating: 4.5,
        review_count: 100,
      },
    ];
    const results = parseSerpResults(raw);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Cheerios');
    expect(results[0].rank).toBe(1);
    expect(results[0].price).toBe(4.99);
    expect(results[0].retailer_product_id).toBe('B123');
  });

  it('uses fallback field names', () => {
    const raw = [{ title: 'Product', url: 'https://example.com', rank: 2 }];
    const results = parseSerpResults(raw);
    expect(results[0].title).toBe('Product');
    expect(results[0].rank).toBe(2);
  });
});

describe('parsePdpResult', () => {
  it('returns null for null input', () => {
    expect(parsePdpResult(null)).toBeNull();
  });

  it('parses Amazon PDP fields', () => {
    const result = parsePdpResult({
      product_title: 'Cheerios Original',
      brand: 'General Mills',
      web_price: 4.99,
      pack_size: '18 oz',
      availability: true,
      average_of_reviews: 4.5,
      number_of_reviews: 200,
      product_url: 'https://www.amazon.com/dp/B123',
    });
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Cheerios Original');
    expect(result!.price).toBe(4.99);
    expect(result!.brand).toBe('General Mills');
    expect(result!.size_raw).toBe('18 oz');
    expect(result!.in_stock).toBe(true);
    expect(result!.rating).toBe(4.5);
  });

  it('handles missing price gracefully', () => {
    const result = parsePdpResult({ product_title: 'Item' });
    expect(result!.price).toBeNull();
  });
});

describe('pdpToProduct', () => {
  it('converts PDP result to ParsedProduct', () => {
    const pdp = parsePdpResult({
      product_title: 'Cheerios',
      brand: 'GM',
      web_price: 4.99,
      pack_size: '18 oz',
      availability: true,
      product_url: 'https://amazon.com/dp/B123',
    })!;
    const product = pdpToProduct(pdp, 'https://amazon.com/dp/B123', 'B123');
    expect(product.name).toBe('Cheerios');
    expect(product.shelf_price).toBe(4.99);
    expect(product.size_oz).toBe(18);
    expect(product.confidence).toBe(0.9);
    expect(product.retailer_product_id).toBe('B123');
  });
});
