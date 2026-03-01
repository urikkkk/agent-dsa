---
skill: normalize-product-data
version: 1.0.0
last_updated: 2026-03-01
owner: agent-dsa
triggers:
  - "when raw product data needs normalization before validation or storage"
  - "when parsing size strings from retailer data"
  - "when computing unit prices"
  - "when cleaning product URLs"
depends_on: []
---

## Scope

Size parsing (oz/lb/g/kg/multipacks), unit price computation, URL normalization (stripping tracking params), and retailer product ID extraction from URLs.

Does NOT cover: Validation (see `validate-observation`), retailer-specific quirks (see `retailer-*.md`).

## Size Parsing

Function: `parseSize(raw: string) -> { oz: number, raw: string, pack_count: number }`

### Supported Formats (in match order)

| Format | Example | Regex | Result |
|--------|---------|-------|--------|
| Multipack | `"12 x 1.5oz"`, `"12 ct x 1.5 oz"` | `/(\d+)\s*(?:x\|ct\s*x\|pk\s*x\|pack\s*x)\s*(\d+\.?\d*)\s*(?:oz\|ounce)/i` | `oz = 12 * 1.5 = 18`, `pack_count = 12` |
| Count only | `"12 ct"`, `"12 pack"`, `"12 bags"` | `/^(\d+)\s*(?:ct\|count\|pk\|pack\|bags?)$/i` | `oz = 0`, `pack_count = 12` |
| Ounces | `"18 oz"`, `"18.5 ounces"` | `/(\d+\.?\d*)\s*(?:oz\|ounce)/i` | `oz = 18` |
| Grams | `"510g"`, `"510 grams"` | `/(\d+\.?\d*)\s*(?:g\|gram)/i` | `oz = grams / 28.3495` |
| Pounds | `"1.5 lb"`, `"1.5 lbs"` | `/(\d+\.?\d*)\s*(?:lb\|lbs\|pound)/i` | `oz = pounds * 16` |

### Conversion Factors

```yaml
g_to_oz: 0.035274  # 1g = 1/28.3495 oz
lb_to_oz: 16       # 1lb = 16 oz
kg_to_oz: 35.274   # 1kg = 1000/28.3495 oz
```

### Edge Cases

- If no format matches, return `{ oz: 0, raw: original_string, pack_count: 1 }`
- Multipack regex captures `pack_count` and computes `total_oz = individual_oz * pack_count`
- Count-only items (e.g., "12 ct") have `oz: 0` — unit price cannot be computed per oz

## Unit Price Computation

Function: `computeUnitPrice(price: number, sizeOz: number) -> number`

```
unit_price = round(price / sizeOz, 2)  # $/oz
```

Returns `0` if `sizeOz <= 0` or `price <= 0`.

## URL Normalization

Function: `normalizeUrl(url: string) -> string`

### Stripped Parameters

```yaml
tracking_params:
  - utm_source
  - utm_medium
  - utm_campaign
  - utm_content
  - utm_term
  - ref
  - clickid
  - gclid
  - fbclid
  - srsltid
  - adid
  - wmlspartner
```

All listed query parameters are removed. Other parameters are preserved.

## Retailer Product ID Extraction

Function: `extractRetailerProductId(url: string, domain: string) -> string | null`

### Extraction Rules

| Retailer | Domain | URL Pattern | Regex | Example |
|----------|--------|-------------|-------|---------|
| Amazon | amazon.com | `/dp/{ASIN}` | `/\/dp\/([A-Z0-9]{10})/` | `/dp/B001E5E2M2` -> `B001E5E2M2` |
| Walmart | walmart.com | `/ip/{slug}/{id}` or `/ip/{id}` | `/\/ip\/(?:[^/]+\/)?(\d+)/` | `/ip/Cheerios/123456` -> `123456` |
| Target | target.com | `/-/A-{id}` | `/A-(\d+)/` | `/-/A-12345678` -> `A-12345678` |
| Kroger | kroger.com | `/p/{slug}/{id}` or `/p/{id}` | `/\/p\/(?:[^/]+\/)?(\d+)/` | `/p/cheerios/0001234567` -> `0001234567` |

Returns `null` if no match found.

## Success Criteria

- [ ] Size string parsed into ounces with correct conversion
- [ ] Multipack detection works (e.g., "12 x 1.5oz" = 18oz, pack_count = 12)
- [ ] Unit price computed correctly as $/oz
- [ ] URLs stripped of tracking parameters
- [ ] Retailer product IDs extracted from URLs for all 4 retailers

## Examples

### Example: Parse size "2 x 18 oz"
```
parseSize("2 x 18 oz")
-> { oz: 36, raw: "2 x 18 oz", pack_count: 2 }
```

### Example: Parse size "510g"
```
parseSize("510g")
-> { oz: 17.99, raw: "510g", pack_count: 1 }
```

### Example: Compute unit price
```
computeUnitPrice(5.99, 18)
-> 0.33  # $0.33/oz
```

### Example: Normalize URL
```
normalizeUrl("https://www.walmart.com/ip/123456?utm_source=google&wmlspartner=abc&ref=123")
-> "https://www.walmart.com/ip/123456"
```

### Example: Extract Amazon ASIN
```
extractRetailerProductId("https://www.amazon.com/dp/B001E5E2M2?ref=abc", "amazon.com")
-> "B001E5E2M2"
```

## Update Steps

1. If new size formats appear (e.g., fluid ounces, milliliters), add regex patterns and conversion factors
2. If new tracking parameters appear, add them to the stripped params list
3. If a new retailer is added, add URL pattern and product ID regex
4. Source file: `agent/src/lib/normalize.ts`
