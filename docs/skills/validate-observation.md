---
skill: validate-observation
version: 1.0.0
last_updated: 2026-03-01
owner: agent-dsa
triggers:
  - "before writing any observation to storage (auto-called by write-observation)"
  - "when running a dry-run validation check"
depends_on:
  - category-rules
---

## Scope

All validation checks applied to observations, quality scoring formula, and category-aware bounds.

Does NOT cover: Category definitions (see `category-rules`), storage logic (see `write-observation`).

## Validation Input

```typescript
{
  shelf_price?: number;
  promo_price?: number;
  unit_price?: number;
  size_oz?: number;
  size_raw?: string;
  in_stock?: boolean;
  source_url?: string;
  retailer_domain?: string;
  rating?: number;
  confidence?: number;
  category?: string;  // default: 'other'
}
```

## Validation Rules

| Rule | Check | Failure Condition | Severity |
|------|-------|-------------------|----------|
| `price_non_null` | Price exists | `shelf_price == null` | fail |
| `price_positive` | Price > 0 | `shelf_price <= 0` | fail |
| `price_bounds` | Within category range | Price outside `[min, max]` for category | warn (soft) / fail (extreme) |
| `promo_sanity` | Promo less than shelf | `promo_price >= shelf_price` | warn |
| `size_parseable` | Size extracted | `size_oz == 0` or `null` | warn |
| `unit_price_consistency` | price/oz matches unit_price | More than 10% mismatch | fail |
| `url_domain_match` | URL domain matches retailer | Domain mismatch | fail |
| `rating_bounds` | Rating in 0-5 range | Outside `[0, 5]` | warn |
| `confidence_bounds` | Confidence in 0-1 range | Outside `[0, 1]` | warn |

## Category Price Bounds

```yaml
cereal:  [0.50, 30.00]
snacks:  [0.50, 25.00]
baking:  [0.50, 20.00]
yogurt:  [0.30, 15.00]
meals:   [1.00, 40.00]
pet:     [1.00, 80.00]
other:   [0.10, 100.00]
```

See `category-rules` for full category definitions.

## Quality Score Calculation

```
Start: quality_score = 1.0

For each check:
  if severity == 'fail':  check_score = 0.3
  if severity == 'warn':  check_score = 0.7
  if severity == 'pass':  check_score = 1.0

Additional deductions:
  - No price or price <= 0:  deduct 0.3
  - No size or size <= 0:    deduct 0.1

Final: quality_score = clamp(average(all_check_scores) - deductions, 0, 1)
```

## Validation Output

```typescript
{
  validation_status: 'pass' | 'warn' | 'fail';
  quality_score: number;   // 0-1
  reasons: string[];       // human-readable list of issues
  checks_run: string[];    // names of all checks executed
}
```

**Status determination:**
- `fail` if ANY check has severity `fail`
- `warn` if ANY check has severity `warn` (but no fails)
- `pass` if ALL checks pass

## Procedure

1. Determine category (default: `'other'`)
2. Run each validation rule against the input
3. Collect all reasons (human-readable strings)
4. Compute quality score using the formula above
5. Determine overall status (`pass`/`warn`/`fail`)
6. Return `ValidationOutput`

## Tool: `validate_observation`

Optional dry-run tool. Same inputs as above, returns `ValidationOutput` without writing anything. Useful for pre-checking data before calling `write_observation`.

Note: `write_observation` auto-calls validation — you don't need to call this separately unless you want a preview.

## Success Criteria

- [ ] All 9 validation rules executed
- [ ] Category-specific price bounds applied correctly
- [ ] Quality score computed and clamped to [0, 1]
- [ ] Reasons array contains human-readable descriptions of all issues
- [ ] Overall status reflects the worst severity among all checks

## Examples

### Example: Valid observation
**Input:** `{ shelf_price: 5.99, size_oz: 18, unit_price: 0.33, category: "cereal" }`
**Output:**
```json
{
  "validation_status": "pass",
  "quality_score": 1.0,
  "reasons": [],
  "checks_run": ["price_non_null", "price_positive", "price_bounds", "size_parseable", "unit_price_consistency"]
}
```

### Example: Price out of bounds
**Input:** `{ shelf_price: 99.99, category: "cereal" }`
**Output:**
```json
{
  "validation_status": "warn",
  "quality_score": 0.7,
  "reasons": ["price 99.99 outside expected range [0.50, 30.00] for cereal"],
  "checks_run": ["price_non_null", "price_positive", "price_bounds"]
}
```

### Example: Missing price
**Input:** `{ shelf_price: null, category: "snacks" }`
**Output:**
```json
{
  "validation_status": "fail",
  "quality_score": 0.0,
  "reasons": ["shelf_price is null"],
  "checks_run": ["price_non_null"]
}
```

## Update Steps

1. To add a new validation rule, add it to the rules table and implement the check
2. To adjust quality score weights, update the scoring formula
3. To change category bounds, update `category-rules` (not this file)
4. Source file: `agent/src/tools/validate.ts` (runValidationChecks, ValidationInput, ValidationOutput)
