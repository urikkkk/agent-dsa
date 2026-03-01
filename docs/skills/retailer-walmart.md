---
skill: retailer-walmart
version: 1.0.0
last_updated: 2026-03-01
owner: agent-dsa
triggers:
  - "when processing product data from Walmart"
  - "when parsing Walmart SERP or PDP results"
  - "when extracting Walmart product IDs from URLs"
depends_on: []
---

## Scope

Walmart-specific product ID patterns, URL formats, pricing field priorities, promo detection, and known quirks.

Does NOT cover: Generic normalization (see `normalize-product-data`), WSA agent selection (see `wsa-agent-selection`).

## Product ID

- **Type:** Numeric product ID
- **Format:** Numeric string (variable length)
- **Regex:** `^\d+$`
- **Examples:** `123456789`, `56789012`
- **PDP input key:** `product_id`

## URL Patterns

| Type | Pattern | Example |
|------|---------|---------|
| Product detail | `/ip/{id}` | `https://www.walmart.com/ip/123456789` |
| Product detail (with slug) | `/ip/{slug}/{id}` | `https://www.walmart.com/ip/Cheerios-Cereal/123456789` |
| Search results | `/search?q={keyword}` | `https://www.walmart.com/search?q=cheerios` |

**Product ID extraction regex:** `/\/ip\/(?:[^/]+\/)?(\d+)/`

Note: The regex handles both `/ip/123456` and `/ip/Cheerios-Cereal/123456` patterns.

## WSA Agents

| Agent | Template ID | Entity Type |
|-------|-------------|-------------|
| `walmart_serp` | 2627 | SERP |
| `walmart_pdp` | 2411 | PDP |

## Price Field Priority Chain

For PDP parsing, try fields in this order:
1. `web_price` — online selling price
2. `price` — generic price field
3. `shelf_price` — in-store shelf price
4. `product_price` — product-level price

## Promo Detection

- **Rollback:** Walmart's term for temporary price reductions. Look for `was_price` or `rollback_price` fields.
  - If `price < was_price`, the product is on Rollback
- **Clearance:** Deep discounts on discontinued items. Look for `clearance` flag.
- **Price comparison text:** Some results include "was $X.XX" text in description.

## Geo/Location Behavior

- Walmart strongly ties pricing and availability to store location
- `zip_code` parameter significantly affects results
- In-store vs online prices may differ — WSA returns the online price for the given zip
- Store-specific inventory affects `in_stock` status
- Walmart+ members may see different prices (not captured by WSA)

## Known Quirks

1. **Sold & Shipped by Walmart vs Marketplace:** Walmart.com includes third-party marketplace sellers. Price and availability may vary.
2. **Pickup vs Delivery:** Availability can differ between pickup, delivery, and shipping. WSA typically returns shipping availability.
3. **Price per unit display:** Walmart shows "price per oz" or "price per count" on the page. The `unit_price` or `price_per_unit` field may capture this.
4. **Multipack URLs:** Some multipacks share a product ID with the single item but differ in the `variant` selection. Check size carefully.
5. **wmlspartner tracking param:** Walmart URLs often include `wmlspartner` — this is stripped by URL normalization.
6. **Sponsored items:** SERP results include sponsored placements flagged by `is_sponsored` or `sponsored` fields.

## Success Criteria

- [ ] Numeric product ID correctly extracted from Walmart URLs (both slug and direct patterns)
- [ ] Price sourced from correct priority field
- [ ] Rollback detected when `price < was_price`
- [ ] Location-specific pricing captured via zip_code
- [ ] Marketplace vs Walmart-sold items distinguished when possible

## Examples

### Example: Parse Walmart PDP
**Raw fields:**
```json
{
  "title": "Cheerios Cereal, 18 oz",
  "price": 4.98,
  "was_price": null,
  "pack_size": "18 oz",
  "in_stock": true,
  "rating": 4.6,
  "review_count": 892,
  "product_id": "123456789"
}
```

**Parsed:**
- `shelf_price`: 4.98
- `promo_price`: null (no `was_price` means no rollback)
- `size_raw`: "18 oz"
- `in_stock`: true
- `retailer_product_id`: "123456789"

### Example: Rollback detected
```json
{ "price": 3.98, "was_price": 4.98 }
```
- `shelf_price`: 4.98 (the `was_price` is the regular price)
- `promo_price`: 3.98 (the current discounted price)

## Update Steps

1. If Walmart changes URL patterns, update the extraction regex
2. If new price/promo fields appear, update the priority chain
3. Source files: `agent/src/lib/normalize.ts` (extractRetailerProductId), `agent/src/lib/parsers.ts`, `supabase/seed.sql`
