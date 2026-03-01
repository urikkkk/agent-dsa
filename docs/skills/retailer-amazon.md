---
skill: retailer-amazon
version: 1.0.0
last_updated: 2026-03-01
owner: agent-dsa
triggers:
  - "when processing product data from Amazon"
  - "when parsing Amazon SERP or PDP results"
  - "when extracting Amazon product IDs from URLs"
depends_on: []
---

## Scope

Amazon-specific product ID patterns, URL formats, pricing field priorities, promo detection, and known quirks.

Does NOT cover: Generic normalization (see `normalize-product-data`), WSA agent selection (see `wsa-agent-selection`).

## Product ID

- **Type:** ASIN (Amazon Standard Identification Number)
- **Format:** 10 alphanumeric characters, starts with `B`
- **Regex:** `^B[A-Z0-9]{9}$`
- **Examples:** `B001E5E2M2`, `B07HGKFL9H`
- **PDP input key:** `asin` (not `product_id`)

## URL Patterns

| Type | Pattern | Example |
|------|---------|---------|
| Product detail | `/dp/{ASIN}` | `https://www.amazon.com/dp/B001E5E2M2` |
| Product detail (with slug) | `/{slug}/dp/{ASIN}` | `https://www.amazon.com/Cheerios-Heart-Healthy/dp/B001E5E2M2` |
| Search results | `/s?k={keyword}` | `https://www.amazon.com/s?k=cheerios+cereal` |

**Product ID extraction regex:** `/\/dp\/([A-Z0-9]{10})/`

## WSA Agents

| Agent | Template ID | Entity Type |
|-------|-------------|-------------|
| `amazon_serp` | 2196 | SERP |
| `amazon_pdp` | 2414 | PDP |

## Price Field Priority Chain

For PDP parsing, try fields in this order:
1. `web_price` — current selling price
2. `price` — generic price field
3. `shelf_price` — shelf price
4. `product_price` — product-level price

## Promo Detection

- **Subscribe & Save:** Look for `subscribe_save_price` or `sns_price` fields
  - This is NOT a traditional promotion — it's a recurring discount
  - Treat as a separate price point, not `promo_price`
- **Lightning Deals:** Temporary steep discounts, look for `deal_price`
- **Coupons:** Look for `coupon_text` or `clip_coupon` field
  - Value may be a percentage ("Save 10%") or absolute ("Save $1.00")
- **List Price:** `list_price` field shows the "was" price (strikethrough price)
  - If `price < list_price`, the difference is the effective promotion

## Geo/Location Behavior

- Amazon supports `zip_code` for location-specific pricing
- Pricing may vary by delivery address (esp. for marketplace sellers)
- Availability is location-dependent (fulfillment center proximity)

## Known Quirks

1. **Marketplace Sellers:** Amazon results include third-party sellers. The "Buy Box" price is the primary price, but other offers may exist at different prices.
2. **Variations/Variants:** A single ASIN may have size/flavor variants. The `variants` array in PDP response lists them. Each variant has its own ASIN.
3. **Add-on Items:** Some products are "Add-on Items" requiring a $25+ order. Still has a price but limited availability.
4. **Amazon's Choice / Best Seller badges:** Captured in `badge` field from SERP results.
5. **Rating format:** Uses 5-star scale. `average_of_reviews` for rating, `number_of_reviews` for count.
6. **Price suppression:** Some products hide price until added to cart. PDP may return `null` for price in these cases.

## Success Criteria

- [ ] ASIN correctly extracted from Amazon URLs
- [ ] Price sourced from correct priority field
- [ ] Subscribe & Save price distinguished from promo price
- [ ] Marketplace vs Amazon-sold distinction noted
- [ ] Variants tracked when present

## Examples

### Example: Parse Amazon PDP
**Raw fields:**
```json
{
  "product_title": "Cheerios Heart Healthy Cereal",
  "web_price": 5.99,
  "list_price": 6.49,
  "subscribe_save_price": 5.69,
  "pack_size": "18 oz",
  "availability": "In Stock",
  "average_of_reviews": 4.7,
  "number_of_reviews": 12543,
  "asin": "B001E5E2M2"
}
```

**Parsed:**
- `shelf_price`: 5.99 (from `web_price`)
- `promo_price`: null (Subscribe & Save is NOT a promo)
- `size_raw`: "18 oz"
- `in_stock`: true
- `retailer_product_id`: "B001E5E2M2"

## Update Steps

1. If Amazon changes URL patterns, update the extraction regex
2. If new price fields appear in Nimble PDP responses, update the priority chain
3. Source files: `agent/src/lib/normalize.ts` (extractRetailerProductId), `agent/src/lib/parsers.ts` (price priority), `supabase/seed.sql`
