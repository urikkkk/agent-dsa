---
skill: category-rules
version: 1.0.0
last_updated: 2026-03-01
owner: agent-dsa
triggers:
  - "when validating observation data against category-specific bounds"
  - "when interpreting product categories for validation"
  - "when checking if a price is reasonable for a product type"
depends_on: []
---

## Scope

Per-category validation bounds, expected size formats, and typical promo patterns. Used by `validate-observation` for category-aware checks.

Does NOT cover: Validation logic itself (see `validate-observation`), retailer-specific rules (see `retailer-*.md`).

## Category Registry

```yaml
categories:
  cereal:
    price_range: [0.50, 30.00]
    common_sizes: [oz, lb]
    typical_sizes: ["10 oz", "12 oz", "18 oz", "27 oz", "2 x 18 oz"]
    promo_patterns: [BOGO, clip_coupon, percentage_off, buy_x_save_y]
    notes: "Multipacks common (e.g., 2-pack, family size). Large sizes up to 27+ oz."
    brands:
      our: [Cheerios, "Honey Nut Cheerios", "Lucky Charms", "Cinnamon Toast Crunch"]
      competitor: ["Frosted Flakes", "Raisin Bran", "Froot Loops"]

  snacks:
    price_range: [0.50, 25.00]
    common_sizes: [oz, ct]
    typical_sizes: ["6 ct", "8 ct", "12 ct", "7.5 oz", "10 oz"]
    promo_patterns: [clip_coupon, percentage_off, multipack_discount]
    notes: "Count-based sizing common for bars. Oz-based for chips/crackers."
    brands:
      our: ["Nature Valley", "Annie's"]
      competitor: ["Quaker Chewy"]

  baking:
    price_range: [0.50, 20.00]
    common_sizes: [oz, ct]
    typical_sizes: ["8 oz", "16.3 oz", "12 ct"]
    promo_patterns: [clip_coupon, seasonal_sale]
    notes: "Seasonal pricing spikes around holidays (Thanksgiving, Christmas)."
    brands:
      our: [Pillsbury]
      competitor: []

  yogurt:
    price_range: [0.30, 15.00]
    common_sizes: [oz, ct]
    typical_sizes: ["6 oz", "32 oz", "4 ct", "8 ct"]
    promo_patterns: [BOGO, percentage_off, buy_x_for_y]
    notes: "Single-serve (4-6 oz) vs multipack (4-8 ct) vs tub (32 oz). Very price-sensitive category."
    brands:
      our: [Yoplait]
      competitor: []

  meals:
    price_range: [1.00, 40.00]
    common_sizes: [oz, lb, ct]
    typical_sizes: ["10 oz", "16 oz", "24 oz", "4 ct"]
    promo_patterns: [clip_coupon, buy_x_save_y]
    notes: "Wide price range due to frozen vs refrigerated vs shelf-stable."
    brands:
      our: []
      competitor: []

  pet:
    price_range: [1.00, 80.00]
    common_sizes: [lb, oz, ct]
    typical_sizes: ["3 lb", "6 lb", "16 lb", "30 lb", "24 ct"]
    promo_patterns: [subscribe_save, clip_coupon, percentage_off]
    notes: "Large bags can be expensive. Subscribe & Save common on Amazon."
    brands:
      our: []
      competitor: []

  other:
    price_range: [0.10, 100.00]
    common_sizes: [oz, lb, ct, g]
    typical_sizes: []
    promo_patterns: [clip_coupon, percentage_off]
    notes: "Catch-all category. Wide bounds to avoid false validation failures."
    brands:
      our: []
      competitor: []
```

## Category Type Definition

```typescript
type ProductCategory = 'cereal' | 'snacks' | 'baking' | 'yogurt' | 'meals' | 'pet' | 'other'
```

## Products by Category

From seed data:

| Category | Products | Is Competitor? |
|----------|----------|---------------|
| cereal | Cheerios Original, Honey Nut Cheerios, Lucky Charms, Cinnamon Toast Crunch | No |
| cereal | Frosted Flakes, Raisin Bran, Froot Loops | Yes (Kellogg's) |
| snacks | Nature Valley Crunchy Granola Bars, Annie's Organic Cheddar Bunnies | No |
| snacks | Quaker Chewy Granola Bars | Yes (Quaker) |
| baking | Pillsbury Crescent Rolls | No |
| yogurt | Yoplait Original Strawberry | No |

## How Validation Uses Categories

When `validate-observation` runs the `price_bounds` check:

1. Look up the observation's category (default: `'other'`)
2. Get `price_range` for that category
3. If `shelf_price < min` or `shelf_price > max`:
   - Soft violation (within 2x bounds): severity `warn`
   - Hard violation (extreme outlier): severity `fail`

## Success Criteria

- [ ] Every observation has a category (or defaults to `'other'`)
- [ ] Price bounds applied from the correct category
- [ ] Size format expectations match the category's common sizes
- [ ] Promo patterns are category-appropriate

## Examples

### Example: Valid cereal price
- Product: Cheerios 18 oz
- `shelf_price`: 5.99
- Category: `cereal`, bounds: [0.50, 30.00]
- Result: `pass` (within bounds)

### Example: Suspiciously high cereal price
- Product: Cheerios 18 oz
- `shelf_price`: 45.00
- Category: `cereal`, bounds: [0.50, 30.00]
- Result: `warn` (above max but not extreme)

### Example: Impossible pet food price
- Product: Dog Food 30 lb
- `shelf_price`: 0.05
- Category: `pet`, bounds: [1.00, 80.00]
- Result: `fail` (below min — likely a parsing error)

## Update Steps

1. To add a new category: add a YAML block with price_range, common_sizes, promo_patterns
2. To adjust bounds: update the `price_range` values based on observed market data
3. To add brands: update the `brands.our` or `brands.competitor` lists
4. Keep YAML format — easy to parse and update without code changes
5. Source files: `agent/src/tools/validate.ts` (category bounds object), `shared/src/types.ts` (ProductCategory)
