import { describe, it, expect } from 'vitest';
import { runValidationChecks } from './validate.js';

describe('runValidationChecks', () => {
  it('passes valid cereal observation', () => {
    const result = runValidationChecks({
      shelf_price: 4.99,
      size_oz: 18,
      in_stock: true,
      source_url: 'https://www.walmart.com/ip/Cheerios/123',
      retailer_domain: 'walmart.com',
    });
    expect(result.validation_status).toBe('pass');
    expect(result.quality_score).toBeGreaterThan(0.8);
  });

  it('fails on null price', () => {
    const result = runValidationChecks({});
    expect(result.validation_status).toBe('fail');
    expect(result.reasons).toContain('Shelf price is null');
  });

  it('fails on zero price', () => {
    const result = runValidationChecks({ shelf_price: 0 });
    expect(result.validation_status).toBe('fail');
  });

  it('warns on price outside category bounds', () => {
    const result = runValidationChecks({
      shelf_price: 50,
      category: 'cereal',
    });
    expect(result.validation_status).toBe('warn');
    expect(result.reasons.some((r) => r.includes('outside typical cereal range'))).toBe(true);
  });

  it('warns when promo >= shelf', () => {
    const result = runValidationChecks({
      shelf_price: 4.99,
      promo_price: 5.99,
    });
    expect(result.reasons.some((r) => r.includes('Promo price'))).toBe(true);
  });

  it('fails on unit price mismatch', () => {
    const result = runValidationChecks({
      shelf_price: 5.99,
      size_oz: 18,
      unit_price: 1.0, // expected ~0.33
    });
    expect(result.validation_status).toBe('fail');
    expect(result.reasons.some((r) => r.includes('mismatch'))).toBe(true);
  });

  it('fails on URL domain mismatch', () => {
    const result = runValidationChecks({
      shelf_price: 4.99,
      source_url: 'https://www.amazon.com/dp/B123',
      retailer_domain: 'walmart.com',
    });
    expect(result.validation_status).toBe('fail');
    expect(result.reasons.some((r) => r.includes('does not match retailer'))).toBe(true);
  });

  it('passes on matching URL domain', () => {
    const result = runValidationChecks({
      shelf_price: 4.99,
      size_oz: 18,
      source_url: 'https://www.walmart.com/ip/Cheerios/123',
      retailer_domain: 'walmart.com',
    });
    expect(result.validation_status).toBe('pass');
  });

  it('warns on rating out of bounds', () => {
    const result = runValidationChecks({
      shelf_price: 4.99,
      rating: 6,
    });
    expect(result.reasons.some((r) => r.includes('Rating'))).toBe(true);
  });

  it('warns on confidence out of bounds', () => {
    const result = runValidationChecks({
      shelf_price: 4.99,
      confidence: 1.5,
    });
    expect(result.reasons.some((r) => r.includes('Confidence'))).toBe(true);
  });
});
