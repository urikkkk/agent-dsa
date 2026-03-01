import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { ValidationStatus } from '@agent-dsa/shared';

export const validateObservationTool = tool(
  'validate_observation',
  'Run quality checks on an observation before writing it. Validates price bounds, size parsing, unit price consistency, and other data quality rules. Returns a validation status and quality score.',
  {
    shelf_price: z.number().optional(),
    promo_price: z.number().optional(),
    unit_price: z.number().optional(),
    size_oz: z.number().optional(),
    size_raw: z.string().optional(),
    in_stock: z.boolean().optional(),
    source_url: z.string().optional(),
    retailer_domain: z.string().optional(),
    category: z
      .enum(['cereal', 'snacks', 'baking', 'yogurt', 'meals', 'pet', 'other'])
      .optional()
      .default('other'),
  },
  async (args) => {
    const reasons: string[] = [];
    let severity: ValidationStatus = 'pass';

    // Price non-null check
    if (args.shelf_price == null) {
      reasons.push('Shelf price is null');
      severity = 'fail';
    }

    // Price positive check
    if (args.shelf_price != null && args.shelf_price <= 0) {
      reasons.push(`Shelf price is ${args.shelf_price}`);
      severity = 'fail';
    }

    // Category-specific price bounds
    const priceBounds: Record<string, [number, number]> = {
      cereal: [0.5, 30],
      snacks: [0.5, 25],
      baking: [0.5, 20],
      yogurt: [0.3, 15],
      meals: [1, 40],
      pet: [1, 80],
      other: [0.1, 100],
    };
    const [minPrice, maxPrice] = priceBounds[args.category] || [0.1, 100];
    if (
      args.shelf_price != null &&
      args.shelf_price > 0 &&
      (args.shelf_price < minPrice || args.shelf_price > maxPrice)
    ) {
      reasons.push(
        `Shelf price $${args.shelf_price} outside typical ${args.category} range ($${minPrice}-$${maxPrice})`
      );
      if (severity !== 'fail') severity = 'warn';
    }

    // Promo price sanity
    if (
      args.promo_price != null &&
      args.shelf_price != null &&
      args.promo_price >= args.shelf_price
    ) {
      reasons.push(
        `Promo price $${args.promo_price} >= shelf price $${args.shelf_price}`
      );
      if (severity !== 'fail') severity = 'warn';
    }

    // Size parseable check
    if (args.size_oz == null || args.size_oz === 0) {
      reasons.push('Size could not be parsed');
      if (severity !== 'fail') severity = 'warn';
    }

    // Unit price consistency
    if (
      args.shelf_price &&
      args.size_oz &&
      args.size_oz > 0 &&
      args.unit_price
    ) {
      const expected = args.shelf_price / args.size_oz;
      const diff = Math.abs(args.unit_price - expected) / expected;
      if (diff > 0.1) {
        reasons.push(
          `Unit price $${args.unit_price}/oz vs expected $${expected.toFixed(2)}/oz (${(diff * 100).toFixed(0)}% mismatch)`
        );
        severity = 'fail';
      }
    }

    // URL domain match
    if (args.source_url && args.retailer_domain) {
      try {
        const urlDomain = new URL(args.source_url).hostname;
        if (!urlDomain.includes(args.retailer_domain)) {
          reasons.push(
            `URL domain ${urlDomain} does not match retailer ${args.retailer_domain}`
          );
          severity = 'fail';
        }
      } catch {
        reasons.push('Invalid source URL');
        if (severity !== 'fail') severity = 'warn';
      }
    }

    // Compute quality score
    let qualityScore = 1.0;
    if (severity === 'fail') qualityScore = 0.3;
    else if (severity === 'warn') qualityScore = 0.7;
    if (!args.shelf_price || args.shelf_price <= 0) qualityScore -= 0.3;
    if (!args.size_oz || args.size_oz <= 0) qualityScore -= 0.1;
    qualityScore = Math.max(0, Math.min(1, qualityScore));

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            validation_status: severity,
            quality_score: Math.round(qualityScore * 100) / 100,
            reasons,
            checks_run: [
              'price_non_null',
              'price_positive',
              'price_bounds',
              'promo_sanity',
              'size_parseable',
              'unit_price_consistency',
              'url_domain_match',
            ],
          }),
        },
      ],
    };
  }
);
