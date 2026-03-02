---
skill: listing-collection
version: 1.0.0
last_updated: 2026-03-01
owner: agent-dsa
triggers:
  - "when the agent needs to find products matching a keyword on a retailer"
  - "when building a candidate list for price comparison or SOV analysis"
  - "when starting a best_price, price_trend, oos_monitor, or promotion_scan pipeline"
depends_on:
  - wsa-agent-selection
  - normalize-product-data
---

## Scope

Searching a retailer's product listings via WSA SERP agent, parsing raw results into normalized candidates, deduplicating, and writing to storage.

Does NOT cover: Product detail page extraction (see `detail-collection`), retailer-specific quirks (see `retailer-*.md`), fallback when WSA fails (see `fallback-collection`).

## Procedure

1. **Select the SERP agent** using `wsa-agent-selection`:
   - Look up `{retailer}_serp` in the agent registry
   - If no agent exists, trigger `fallback-collection` instead

2. **Call `serp_search` tool**:
   ```json
   {
     "agent_name": "amazon_serp",
     "keyword": "Cheerios cereal",
     "zip_code": "60601",
     "run_id": "<run_id>",
     "retailer_id": "<retailer_id>"
   }
   ```
   - Retry: 2 attempts, 3-15s exponential backoff
   - Request logged to `nimble_requests` before call
   - Response logged to `nimble_responses` after call

3. **Parse results** with `extractSerpItems()` + `parseSerpResults()`:
   - Raw items extracted via `extractSerpItems(responseData)` from `agent/src/lib/parsers.ts`
   - Primary path: `result.data.data.parsing[]` (array of product objects)
   - Fallback paths: `data.parsed_items[]`, `data.results[]`, or `data` as array
   - Each item maps to `NimbleSerpResult`:
     - `rank` — position in search results
     - `title` — product name (`product_name` or `title` or `name`)
     - `url` — product URL (`product_url` or `url` or `link`)
     - `price` — snippet price (`price` or `product_price`)
     - `is_sponsored` — ad flag (`is_sponsored`, `sponsored`, or `is_ad`)
     - `badge` — e.g., "amazons_choice"
     - `retailer_product_id` — `asin` or `product_id`
     - `rating` — star rating
     - `review_count` — number of reviews

4. **Deduplicate candidates** using `dedup_candidates` or `dedup_and_write_serp_candidates`:
   - Extract retailer product ID from URL via `extractRetailerProductId(url, domain)`
   - Normalize URL via `normalizeUrl(url)` (strip tracking params)
   - Dedup key: `retailer_product_id || normalized_url`
   - Keep first occurrence (Set-based)
   - Sort by rank, move sponsored items to bottom

5. **Write candidates** to `serp_candidates` table:
   - Prefer `dedup_and_write_serp_candidates` (combines dedup + write in one call)
   - Maps to DB columns: `rank`, `title`, `is_sponsored`, `snippet_price`, `badge`, `pdp_url`, `retailer_product_id`, `raw_payload`

## Success Criteria

- [ ] SERP agent called with correct `agent_name` and `keyword`
- [ ] Results parsed into normalized `NimbleSerpResult[]`
- [ ] Duplicates removed (by product ID or normalized URL)
- [ ] Sponsored items flagged with `is_sponsored: true`
- [ ] Candidates persisted to `serp_candidates` with `run_id` and `retailer_id`
- [ ] If WSA returns empty/error, fallback triggered (see `fallback-collection`)

## Examples

### Example: Search Walmart for "Cheerios"
**Input:**
```json
{ "agent_name": "walmart_serp", "keyword": "Cheerios", "zip_code": "60601" }
```

**Parsed output (3 of 10 results):**
```json
[
  { "rank": 1, "title": "Cheerios Original Cereal 18 oz", "url": "https://www.walmart.com/ip/123456", "price": 4.98, "is_sponsored": false, "retailer_product_id": "123456" },
  { "rank": 2, "title": "Honey Nut Cheerios 19.5 oz", "url": "https://www.walmart.com/ip/789012", "price": 5.48, "is_sponsored": false, "retailer_product_id": "789012" },
  { "rank": 3, "title": "Cheerios Oat Crunch 26 oz", "url": "https://www.walmart.com/ip/345678", "price": 6.28, "is_sponsored": true, "retailer_product_id": "345678" }
]
```

**Dedup result:**
```json
{ "original_count": 10, "unique_count": 8, "removed": 2, "candidates": [...] }
```

## Update Steps

1. If `parseSerpResults()` field mappings change, update the field name fallback chains listed above
2. If a new retailer is added, add its SERP agent to `wsa-agent-selection` first
3. Source files: `agent/src/tools/serp-search.ts`, `agent/src/lib/parsers.ts` (parseSerpResults), `agent/src/tools/dedup.ts`
