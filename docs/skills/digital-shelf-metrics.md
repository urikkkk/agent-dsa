---
skill: digital-shelf-metrics
version: 1.0.0
last_updated: 2026-03-01
owner: agent-dsa
triggers:
  - "when answering questions about share of voice or brand visibility"
  - "when analyzing price positioning across retailers"
  - "when monitoring out-of-stock rates"
  - "when checking assortment coverage"
  - "when scanning for promotions"
depends_on: []
---

## Scope

Metric definitions and measurement approaches for e-commerce intelligence. Maps each metric to the question types that use it and the data required.

Does NOT cover: Data collection mechanics (see collection skills), validation (see `validate-observation`).

## Metrics

### Share of Voice (SOV)

- **Question type:** `serp_sov`
- **Definition:** The percentage of visible search results owned by a brand on a given retailer SERP for a keyword
- **Formula:** `SOV = (brand_results_in_top_N / N) * 100`
- **Data required:** SERP candidates with `rank`, `title` (for brand detection), `is_sponsored`
- **Approach:**
  1. Search retailer SERP for keyword (e.g., "cereal")
  2. Collect top N results (default: 30, from `serp_sov` template `num_results`)
  3. Classify each result by brand (match against known brands)
  4. Compute % of results per brand
  5. Separate organic vs sponsored SOV
- **Our brands** (default): General Mills, Cheerios, Nature Valley
- **Key distinction:** Sponsored results should be reported separately — organic SOV is the primary metric

### Price Positioning

- **Question type:** `best_price`
- **Definition:** How a product's price compares across retailers
- **Formula:** `position = rank when sorted by price ascending`
- **Data required:** Observations with `shelf_price` and `promo_price` per retailer
- **Approach:**
  1. Collect pricing from all target retailers
  2. Sort by effective price (promo_price if available, else shelf_price)
  3. Report cheapest option, price spread, and unit price comparison
- **Template defaults:** `num_results: 10`, `include_promo: true`

### Out-of-Stock (OOS) Rate

- **Question type:** `oos_monitor`
- **Definition:** Whether a specific product is available at a retailer/location
- **Formula:** `oos_rate = out_of_stock_count / total_checks * 100`
- **Data required:** Observations with `in_stock` boolean
- **Approach:**
  1. Check product availability at each target retailer
  2. Use PDP `in_stock` field
  3. Report per-retailer availability status
  4. If tracking over time, compute OOS rate across observations
- **Template defaults:** `check_variants: true` — also check variant availability

### Assortment Coverage

- **Question type:** `assortment_coverage`
- **Definition:** What percentage of a product catalog is available at a given retailer
- **Formula:** `coverage = products_found / products_in_catalog * 100`
- **Data required:** SERP candidates matched against a known product list
- **Approach:**
  1. Search retailer SERP for each product in the catalog
  2. Match results to known products (by title, UPC, or fuzzy match)
  3. Compute coverage percentage
  4. Report gaps (products not found)
- **Template defaults:** `match_threshold: 0.7` — minimum confidence for a match

### Promotion Detection

- **Question type:** `promotion_scan`
- **Definition:** Discovery of active promotions on products at a retailer
- **Data required:** PDP observations with `promo_price`, `shelf_price`, and retailer-specific promo fields
- **Approach:**
  1. Collect product data from target retailers
  2. Detect promotions:
     - `promo_price < shelf_price`
     - Coupon/deal fields present
     - Badge indicates deal (e.g., "Rollback", "Lightning Deal")
  3. Report active promos with discount amount/percentage
- **Template defaults:** `include_sponsored: false` — exclude sponsored SERP results from promo analysis

### Price Trend

- **Question type:** `price_trend`
- **Definition:** How a product's price has changed over time
- **Data required:** Historical observations with `shelf_price` and `created_at`
- **Approach:**
  1. Query historical observations for the product/retailer
  2. Plot price over time
  3. Detect significant changes (>5% swing)
  4. Report current price vs historical average
- **Template defaults:** `period: "30d"`, `min_observations: 3`

## Question Template Defaults

| Type | Template Name | Key Parameters |
|------|--------------|----------------|
| `best_price` | Best Price Finder | `num_results: 10, include_promo: true` |
| `price_trend` | Price Trend Tracker | `period: "30d", min_observations: 3` |
| `oos_monitor` | Out-of-Stock Monitor | `check_variants: true` |
| `serp_sov` | SERP Share of Voice | `num_results: 30, our_brands: ["General Mills", "Cheerios", "Nature Valley"]` |
| `assortment_coverage` | Assortment Coverage | `match_threshold: 0.7` |
| `promotion_scan` | Promotion Scanner | `include_sponsored: false` |

## Success Criteria

- [ ] Correct metric definition applied for the question type
- [ ] Data requirements met before computing the metric
- [ ] Results include confidence and coverage information
- [ ] Organic vs sponsored distinction made for SOV
- [ ] Promo detection uses retailer-specific logic (see `retailer-*.md`)

## Examples

### Example: SOV for "cereal" on Walmart
- Top 30 results collected
- Brand breakdown: General Mills 23%, Kellogg's 30%, Post 13%, Private Label 10%, Other 24%
- Sponsored: General Mills 2 placements, Kellogg's 1 placement

### Example: Best price for Cheerios 18oz
- Amazon: $5.99, Walmart: $4.98, Target: $5.49, Kroger: $4.79
- Best: Kroger at $4.79 (with digital coupon)
- Unit price range: $0.27-$0.33/oz

## Update Steps

1. If new question types are added, define the corresponding metric
2. If default parameters change, update the template defaults table
3. Source files: `supabase/seed.sql` (question_templates), `shared/src/types.ts` (QuestionType)
