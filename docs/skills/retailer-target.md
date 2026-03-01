---
skill: retailer-target
version: 1.0.0
last_updated: 2026-03-01
owner: agent-dsa
triggers:
  - "when processing product data from Target"
  - "when parsing Target SERP or PDP results"
  - "when extracting Target product IDs from URLs"
depends_on: []
---

## Scope

Target-specific product ID patterns (TCIN), URL formats, pricing field priorities, Circle offers, and known quirks.

Does NOT cover: Generic normalization (see `normalize-product-data`), WSA agent selection (see `wsa-agent-selection`).

## Product ID

- **Type:** TCIN (Target Common Item Number), prefixed with `A-`
- **Format:** `A-` followed by 8 digits
- **Regex:** `A-(\d+)` (extract from URL), displayed as `A-12345678`
- **Examples:** `A-12345678`, `A-87654321`
- **PDP input key:** `product_id`

## URL Patterns

| Type | Pattern | Example |
|------|---------|---------|
| Product detail | `/-/A-{id}` | `https://www.target.com/p/cheerios-cereal/-/A-12345678` |
| Search results | `/s?searchTerm={keyword}` | `https://www.target.com/s?searchTerm=cheerios` |

**Product ID extraction regex:** `/A-(\d+)/`

Returns: `A-{digits}` (includes the `A-` prefix).

## WSA Agents

| Agent | Template ID | Entity Type |
|-------|-------------|-------------|
| `target_serp` | 2068 | SERP |
| `target_pdp` | 2702 | PDP |

## Price Field Priority Chain

For PDP parsing, try fields in this order:
1. `web_price` — current online price
2. `price` — generic price field
3. `shelf_price` — shelf price
4. `product_price` — product-level price

## Promo Detection

- **Target Circle offers:** Digital coupons available to Circle members
  - Look for `circle_offer`, `circle_price`, or `loyalty_price` fields
  - Circle offers require opt-in (not automatic) — treat as a separate promo
  - Common patterns: "Save 15% with Target Circle", "$1 off with Circle"
- **Sale pricing:** Look for `sale_price` or `regular_price` vs `price` comparison
  - If `price < regular_price`, the item is on sale
- **Buy X Get Y:** Look for `deal_text` or `offer_text` fields
  - Examples: "Buy 2 for $8", "Buy 3 get 1 free"

## Geo/Location Behavior

- Target supports `zip_code` for store-specific availability and pricing
- Pricing can differ by store (especially for grocery/fresh items)
- Delivery vs in-store availability may differ
- Ship-to-store and same-day delivery availability are location-dependent

## Known Quirks

1. **Circle offers are NOT automatic:** They require the shopper to "clip" the offer. Report as a promo but note it requires Circle membership.
2. **Drive Up / Order Pickup:** Availability for these fulfillment methods is store-specific. WSA may not distinguish between fulfillment methods.
3. **Target-owned brands:** Brands like Good & Gather, Market Pantry, Up & Up are Target exclusives. They won't appear on other retailers.
4. **RedCard discount:** 5% discount for Target RedCard holders. NOT captured in pricing data (applied at checkout).
5. **Multipacks and bundled pricing:** Target sometimes bundles items (e.g., "2 for $6"). The per-unit price from the PDP is the single-item price.
6. **DPCI vs TCIN:** Target uses two ID systems internally. DPCI (Department-Class-Item) is the in-store ID. TCIN is the online ID used in URLs. We use TCIN.

## Success Criteria

- [ ] TCIN (A-{digits}) correctly extracted from Target URLs
- [ ] Price sourced from correct priority field
- [ ] Circle offers detected and flagged as promos
- [ ] Sale pricing detected (price < regular_price)
- [ ] Location-specific pricing and availability captured

## Examples

### Example: Parse Target PDP
**Raw fields:**
```json
{
  "title": "Cheerios Breakfast Cereal - 18oz - General Mills",
  "price": 5.49,
  "regular_price": 5.49,
  "circle_offer": "Save 15% on cereal with Target Circle",
  "size": "18 oz",
  "availability": "In Stock",
  "rating": 4.5,
  "review_count": 234,
  "product_id": "A-12345678"
}
```

**Parsed:**
- `shelf_price`: 5.49
- `promo_price`: 4.67 (5.49 * 0.85 — 15% Circle offer)
- `size_raw`: "18 oz"
- `in_stock`: true
- `retailer_product_id`: "A-12345678"

### Example: TCIN extraction from URL
```
extractRetailerProductId("https://www.target.com/p/cheerios/-/A-12345678", "target.com")
-> "A-12345678"
```

## Update Steps

1. If Target changes URL patterns (e.g., drops `A-` prefix), update the extraction regex
2. If Circle offer field names change, update promo detection logic
3. Source files: `agent/src/lib/normalize.ts` (extractRetailerProductId), `agent/src/lib/parsers.ts`, `supabase/seed.sql`
