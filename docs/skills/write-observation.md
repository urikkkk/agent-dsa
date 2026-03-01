---
skill: write-observation
version: 1.0.0
last_updated: 2026-03-01
owner: agent-dsa
triggers:
  - "after collecting and normalizing product data"
  - "when persisting a price/availability observation to storage"
depends_on:
  - validate-observation
---

## Scope

Writing a validated observation to storage with upsert logic and dedup constraints. Auto-validates before writing.

Does NOT cover: Data collection (see `listing-collection`, `detail-collection`), normalization (see `normalize-product-data`), answer composition (see `write-answer`).

## Tool: `write_observation`

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `run_id` | string | Current run identifier |
| `retailer_id` | string | Retailer UUID |
| `location_id` | string | Location UUID |

### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `product_id` | string | null | Product UUID |
| `product_match_id` | string | null | Product match UUID |
| `shelf_price` | number | null | Regular price |
| `promo_price` | number | null | Promotional price |
| `unit_price` | number | null | Price per oz |
| `size_oz` | number | null | Size in ounces |
| `size_raw` | string | null | Original size string |
| `pack_count` | number | 1 | Number of items in pack |
| `in_stock` | boolean | null | Availability flag |
| `rating` | number | null | Star rating (0-5) |
| `review_count` | number | null | Number of reviews |
| `serp_rank` | number | null | Position in search results |
| `confidence` | number | null | Data confidence (0-1) |
| `source_url` | string | null | Source page URL |
| `collection_method` | enum | null | `'website_search_agent'` or `'nimble_web_tools'` |
| `collection_tier` | enum | null | `'wsa'`, `'search_extract'`, or `'generic_llm'` |
| `zip_used` | string | null | Zip code used for location |
| `ai_parsed_fields` | object | null | Fields parsed by LLM |
| `ai_confidence` | number | null | LLM parsing confidence (0-1) |
| `raw_payload` | object | null | Raw API response |

## Procedure

1. **Auto-validate** with `runValidationChecks()`:
   - Passes `shelf_price`, `promo_price`, `unit_price`, `size_oz`, `size_raw`, `source_url`, `retailer_domain`, `rating`, `confidence`
   - Returns `validation_status`, `quality_score`, `reasons`

2. **Construct observation row**:
   - All input fields + validation results
   - `validation_status`: from validation output
   - `validation_reasons`: array of reason strings
   - `quality_score`: from validation output

3. **Upsert to `observations` table**:
   - **Uniqueness key**: `(run_id, retailer_id, product_id, location_id)`
   - On conflict: update all data fields (keeps latest observation per product/retailer/run/location)
   - Fallback: if upsert constraint doesn't exist, plain insert

4. **Return result**:
   ```json
   {
     "success": true,
     "observation_id": "<uuid>",
     "validation": {
       "validation_status": "pass",
       "quality_score": 0.95,
       "reasons": [],
       "checks_run": [...]
     }
   }
   ```

## Uniqueness Constraint

```
UNIQUE (run_id, retailer_id, product_id, location_id) WHERE product_id IS NOT NULL
```

This means:
- One observation per product per retailer per location per run
- If the same product is collected twice in one run, the second write updates the first
- Observations without `product_id` are not subject to the unique constraint

## Success Criteria

- [ ] Auto-validation executed before write
- [ ] Observation persisted with validation results attached
- [ ] Upsert respects uniqueness constraint (no duplicate observations)
- [ ] `observation_id` returned on success
- [ ] Validation failures do NOT prevent writing (observation is stored with `validation_status: 'fail'`)

## Examples

### Example: Write a healthy observation
**Input:**
```json
{
  "run_id": "abc-123",
  "retailer_id": "ret-walmart",
  "location_id": "loc-chicago",
  "product_id": "prod-cheerios",
  "shelf_price": 4.98,
  "size_oz": 18,
  "unit_price": 0.28,
  "in_stock": true,
  "confidence": 0.95,
  "source_url": "https://www.walmart.com/ip/123456",
  "collection_method": "website_search_agent",
  "collection_tier": "wsa"
}
```

**Output:**
```json
{
  "success": true,
  "observation_id": "obs-xyz-789",
  "validation": {
    "validation_status": "pass",
    "quality_score": 1.0,
    "reasons": [],
    "checks_run": ["price_non_null", "price_positive", "price_bounds", "size_parseable", "unit_price_consistency"]
  }
}
```

### Example: Write observation with validation warning
**Input:** `{ ..., "shelf_price": 45.00, "category": "cereal" }`
**Output:** validation_status: "warn", reason: "price outside expected range"
Observation is still stored — warnings don't block writes.

## Update Steps

1. If new observation fields are added to the schema, add them to the fields table above
2. If the uniqueness constraint changes, update the constraint documentation
3. Source file: `agent/src/tools/write-results.ts` (writeObservationTool)
