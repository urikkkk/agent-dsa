---
skill: retailer-kroger
version: 1.0.0
last_updated: 2026-03-01
owner: agent-dsa
triggers:
  - "when processing product data from Kroger"
  - "when parsing Kroger SERP or PDP results"
  - "when extracting Kroger product IDs from URLs"
depends_on: []
---

## Scope

Kroger-specific product ID patterns, URL formats, pricing field priorities, digital coupon detection, and known quirks.

Does NOT cover: Generic normalization (see `normalize-product-data`), WSA agent selection (see `wsa-agent-selection`).

## Product ID

- **Type:** Numeric product ID (UPC-based)
- **Format:** Numeric string, often zero-padded (e.g., `0001234567`)
- **Regex:** `^\d+$`
- **Examples:** `0001234567`, `0001111041700`
- **PDP input key:** `product_id`

## URL Patterns

| Type | Pattern | Example |
|------|---------|---------|
| Product detail | `/p/{slug}/{id}` | `https://www.kroger.com/p/cheerios-cereal/0001234567` |
| Product detail (direct) | `/p/{id}` | `https://www.kroger.com/p/0001234567` |
| Search results | `/search?query={keyword}` | `https://www.kroger.com/search?query=cheerios` |

**Product ID extraction regex:** `/\/p\/(?:[^/]+\/)?(\d+)/`

Note: Handles both `/p/cheerios/0001234567` and `/p/0001234567` patterns.

## WSA Agents

| Agent | Template ID | Entity Type |
|-------|-------------|-------------|
| `kroger_serp` | 1991 | SERP |
| `kroger_pdp` | 2100 | PDP |

## Price Field Priority Chain

For PDP parsing, try fields in this order:
1. `web_price` — online price
2. `price` — generic price field
3. `shelf_price` — shelf price
4. `product_price` — product-level price

## Promo Detection

- **Digital Coupons:** Kroger's primary promo mechanism
  - Look for `digital_coupon`, `clip_coupon`, or `coupon_value` fields
  - Coupons must be "clipped" digitally — not automatic
  - Values: dollar-off ("Save $1.00") or percentage ("Save 20%")
- **Weekly Ad pricing:** Temporary sale prices from weekly circular
  - Look for `sale_price` or `ad_price` fields
  - If `price < regular_price`, it's a weekly ad deal
- **Buy X Save Y:** Look for `deal_text` or `promo_text`
  - Example: "Buy 5, Save $5" (Kroger's Mega Event)

## Geo/Location Behavior

- Kroger is heavily location-dependent — pricing and availability vary significantly by store
- `zip_code` is critical for accurate results
- Kroger operates under multiple banners (Ralphs, Fred Meyer, Fry's, etc.) — all use the Kroger domain
- Store selection affects:
  - Product availability (local inventory)
  - Pricing (can vary store-to-store)
  - Promo availability (some deals are region-specific)

## Known Quirks

1. **Banner-specific pricing:** Kroger, Ralphs, Fred Meyer, Fry's, Harris Teeter, etc. all share kroger.com but may have different pricing. Zip code determines which banner's pricing is shown.
2. **Kroger Plus Card pricing:** Some prices require a Kroger Plus Card (loyalty card). These are typically reflected in the standard price shown online.
3. **Digital coupon limit:** Some coupons have quantity limits (e.g., "Limit 5"). Not always captured in scraped data.
4. **Fuel Points:** Kroger offers fuel point promotions on certain purchases. Not relevant to price data but may appear in promo fields.
5. **Private Selection / Simple Truth:** Kroger's private label brands. These are Kroger exclusives.
6. **UPC-based IDs:** Kroger product IDs are often UPC-derived (longer numeric strings). They may be zero-padded.
7. **Mega Events:** "Buy 5, Save $5" type promotions where discount applies only when buying a minimum quantity. The "sale" price shown may assume participation.

## Success Criteria

- [ ] Numeric product ID correctly extracted from Kroger URLs
- [ ] Price sourced from correct priority field
- [ ] Digital coupons detected and flagged as promos
- [ ] Location-specific pricing captured (zip code is critical)
- [ ] Banner differences accounted for when possible

## Examples

### Example: Parse Kroger PDP
**Raw fields:**
```json
{
  "title": "Cheerios Toasted Whole Grain Oat Cereal",
  "price": 4.79,
  "regular_price": 5.49,
  "digital_coupon": "Save $0.50",
  "size": "18 oz",
  "in_stock": true,
  "rating": 4.4,
  "review_count": 156,
  "product_id": "0001234567"
}
```

**Parsed:**
- `shelf_price`: 5.49 (the regular price)
- `promo_price`: 4.29 (current price $4.79 minus $0.50 coupon)
- `size_raw`: "18 oz"
- `in_stock`: true
- `retailer_product_id`: "0001234567"

### Example: Product ID extraction from URL
```
extractRetailerProductId("https://www.kroger.com/p/cheerios-cereal/0001234567", "kroger.com")
-> "0001234567"
```

## Update Steps

1. If Kroger changes URL patterns, update the extraction regex
2. If new promo fields appear (e.g., Mega Event pricing), update detection logic
3. If Kroger adds/removes regional banners, document the change
4. Source files: `agent/src/lib/normalize.ts` (extractRetailerProductId), `agent/src/lib/parsers.ts`, `supabase/seed.sql`
