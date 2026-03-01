---
skill: detail-collection
version: 1.0.0
last_updated: 2026-03-01
owner: agent-dsa
triggers:
  - "when the agent has a candidate URL/product ID and needs detailed pricing and availability"
  - "when building an observation from a product detail page"
  - "after listing-collection identifies candidates worth fetching"
depends_on:
  - wsa-agent-selection
  - normalize-product-data
---

## Scope

Fetching a product's detail page (PDP) via WSA agent, parsing structured data (price, availability, size, ratings), and building an observation-ready record.

Does NOT cover: Listing search (see `listing-collection`), validation (see `validate-observation`), storage (see `write-observation`).

## Procedure

1. **Select the PDP agent** using `wsa-agent-selection`:
   - Look up `{retailer}_pdp` in the agent registry
   - Note the input key: `asin` for Amazon, `product_id` for all others
   - If no agent exists, trigger `fallback-collection`

2. **Call `pdp_fetch` tool**:
   ```json
   {
     "agent_name": "amazon_pdp",
     "product_id": "B001E5E2M2",
     "zip_code": "60601",
     "run_id": "<run_id>",
     "retailer_id": "<retailer_id>"
   }
   ```
   - Retry: 2 attempts, 3-15s exponential backoff
   - Request/response logged to `nimble_requests`/`nimble_responses`

3. **Extract PDP data from response**:
   - Primary: `data.data.parsed_items[0]` (PDP agents return single item in array)
   - Fallback: `data.data` if array is empty

4. **Parse with `parsePdpResult()`** into `NimblePdpResult`:
   - `title` — from `product_title`, `title`, or `name`
   - `brand` — from `brand` field
   - `price` — priority chain: `web_price` -> `price` -> `shelf_price` -> `product_price`
   - `promo_price` — from `promo_price`, or derived from `list_price` comparison
   - `size_raw` — from `pack_size`, `size`, or `unit_of_measure`
   - `unit_price` — from `unit_price` or `price_per_unit`
   - `in_stock` — from `availability`, `in_stock`, or negation of `product_out_of_stock`
   - `rating` — from `average_of_reviews`, `rating`, or `product_rating`
   - `review_count` — from `number_of_reviews`, `review_count`, or `product_reviews_count`

5. **Convert to `ParsedProduct`** with `pdpToProduct()`:
   - Apply `parseSize(size_raw)` to compute `size_oz` and `pack_count`
   - Apply `computeUnitPrice(price, size_oz)` for `unit_price`
   - Apply `normalizeUrl(url)` for `source_url`
   - Compute `confidence` score (0-1):
     - Start at 1.0
     - Deduct if price missing, size unparseable, or data incomplete

6. **Return `ParsedProduct`** ready for `write-observation`:
   ```typescript
   {
     name: string,
     brand: string,
     size_oz: number,
     size_raw: string,
     pack_count: number,
     shelf_price: number,
     promo_price?: number,
     unit_price: number,
     in_stock: boolean,
     rating?: number,
     review_count?: number,
     source_url: string,
     retailer_product_id?: string,
     confidence: number
   }
   ```

## Success Criteria

- [ ] PDP agent called with correct `agent_name` and `product_id`
- [ ] Price extracted via field priority chain
- [ ] Size parsed into ounces (see `normalize-product-data`)
- [ ] `in_stock` determined from availability fields
- [ ] Confidence scored based on data completeness
- [ ] `ParsedProduct` ready for validation and storage

## Examples

### Example: Fetch Amazon Cheerios PDP
**Input:**
```json
{ "agent_name": "amazon_pdp", "product_id": "B001E5E2M2" }
```

**Parsed NimblePdpResult:**
```json
{
  "title": "Cheerios Heart Healthy Cereal",
  "brand": "General Mills",
  "price": 5.99,
  "promo_price": null,
  "size_raw": "18 oz",
  "in_stock": true,
  "rating": 4.7,
  "review_count": 12543,
  "url": "https://www.amazon.com/dp/B001E5E2M2"
}
```

**Converted ParsedProduct:**
```json
{
  "name": "Cheerios Heart Healthy Cereal",
  "brand": "General Mills",
  "size_oz": 18,
  "size_raw": "18 oz",
  "pack_count": 1,
  "shelf_price": 5.99,
  "unit_price": 0.33,
  "in_stock": true,
  "rating": 4.7,
  "review_count": 12543,
  "source_url": "https://www.amazon.com/dp/B001E5E2M2",
  "retailer_product_id": "B001E5E2M2",
  "confidence": 1.0
}
```

## Update Steps

1. If Nimble PDP response fields change, update the field priority chains in step 4
2. If a new retailer is added, add its PDP agent to `wsa-agent-selection` and field mappings to `parsePdpResult()`
3. Source files: `agent/src/tools/pdp-fetch.ts`, `agent/src/lib/parsers.ts` (parsePdpResult, pdpToProduct)
