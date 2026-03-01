---
skill: fallback-collection
version: 1.0.0
last_updated: 2026-03-01
owner: agent-dsa
triggers:
  - "when a WSA agent returns an error or empty results"
  - "when no WSA template exists for a retailer"
  - "when a WSA agent is flagged as unhealthy"
depends_on:
  - nimble-api-reference
---

## Scope

Tier 2 fallback data collection using `web_search_fallback` and `url_extract_fallback` tools when WSA agents are unavailable or fail.

Does NOT cover: WSA agent selection (see `wsa-agent-selection`), WSA-based collection (see `listing-collection`, `detail-collection`).

## Procedure

1. **Determine fallback trigger**:
   - WSA agent returned HTTP error (500/503)
   - WSA agent returned empty `parsed_items`
   - No WSA template exists for this retailer
   - Agent flagged `is_healthy: false` in `nimble_agents` table

2. **Log fallback event** to `fallback_events` table:
   ```json
   {
     "run_id": "<run_id>",
     "retailer_id": "<retailer_id>",
     "keyword": "<search_term>",
     "from_tier": "wsa",
     "to_tier": "search_extract",
     "trigger_reason": "no_wsa_template_or_wsa_failure",
     "trigger_details": { "error": "<error_message>" }
   }
   ```

3. **Web search** via `web_search_fallback`:
   ```json
   {
     "query": "Cheerios cereal",
     "focus": "shopping",
     "max_results": 10,
     "include_domains": ["walmart.com"],
     "deep_search": false,
     "run_id": "<run_id>",
     "retailer_id": "<retailer_id>"
   }
   ```
   - Retry: 2 attempts, 1-10s backoff
   - Request logged with `collection_tier: 'search_extract'`

4. **Extract product pages** via `url_extract_fallback`:
   - For each promising URL from search results:
   ```json
   {
     "url": "https://www.walmart.com/ip/123456",
     "output_format": "markdown",
     "render": false,
     "run_id": "<run_id>",
     "retailer_id": "<retailer_id>"
   }
   ```
   - Retry: 2 attempts, 1-10s backoff

5. **Manual parsing** of extracted content:
   - LLM parses markdown/HTML for price, availability, size
   - Lower confidence than WSA-parsed data (typically 0.4-0.7)

6. **Set collection metadata**:
   - `collection_method: 'nimble_web_tools'`
   - `collection_tier: 'search_extract'`
   - `confidence`: lower than Tier 1 (reflect parsing uncertainty)

## Success Criteria

- [ ] Fallback event logged with trigger reason
- [ ] Web search returns results for the target domain
- [ ] URL extract retrieves parseable content
- [ ] Extracted data converted to observation format
- [ ] `collection_tier` set to `'search_extract'`
- [ ] Confidence score reflects reduced certainty (vs WSA tier)

## Examples

### Example: Walmart WSA fails, fallback succeeds
**Trigger:** `walmart_serp` returns 503

**Step 1 — web_search_fallback:**
```json
{
  "query": "Cheerios cereal site:walmart.com",
  "focus": "shopping",
  "include_domains": ["walmart.com"],
  "max_results": 5
}
```
Returns 5 Walmart product URLs.

**Step 2 — url_extract_fallback:**
```json
{ "url": "https://www.walmart.com/ip/123456", "output_format": "markdown" }
```
Returns markdown with price, title, availability.

**Step 3 — Manual parse:**
```json
{
  "shelf_price": 4.98,
  "in_stock": true,
  "size_raw": "18 oz",
  "confidence": 0.6,
  "collection_tier": "search_extract"
}
```

## Update Steps

1. If Nimble adds new web search focus modes, update the valid values
2. If extraction quality improves, adjust default confidence range
3. Source files: `agent/src/tools/web-search.ts`, `agent/src/tools/url-extract.ts`
