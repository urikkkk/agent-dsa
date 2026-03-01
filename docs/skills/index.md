---
skill: index
version: 1.0.0
last_updated: 2026-03-01
owner: agent-dsa
---

# Skills Registry & Router

## Skill Inventory

| # | Skill | Scope | Triggers | Dependencies |
|---|-------|-------|----------|-------------|
| 1 | [wsa-agent-selection](wsa-agent-selection.md) | Pick the right WSA agent for a retailer + entity type | Agent needs to search or fetch product data | — |
| 2 | [sync-wsa-inventory](sync-wsa-inventory.md) | Refresh WSA agent health/availability | Periodic health check, after failures, on startup | wsa-agent-selection |
| 3 | [nimble-api-reference](nimble-api-reference.md) | Endpoints, auth, errors, timeouts | Any Nimble API call or error debugging | — |
| 4 | [listing-collection](listing-collection.md) | Search retailer listings, parse, dedup, write | Agent needs to find products by keyword | wsa-agent-selection, normalize-product-data |
| 5 | [detail-collection](detail-collection.md) | Fetch product detail page, parse, build observation | Agent has a candidate and needs pricing/availability | wsa-agent-selection, normalize-product-data |
| 6 | [fallback-collection](fallback-collection.md) | Tier 2: web search + URL extract | WSA agent returns error or empty results | nimble-api-reference |
| 7 | [sync-web-toolbox](sync-web-toolbox.md) | Verify web tool availability and health | Before fallback, periodic refresh, after failures | nimble-api-reference |
| 8 | [normalize-product-data](normalize-product-data.md) | Size parsing, unit price, URL normalization | Raw product data needs normalization | — |
| 9 | [validate-observation](validate-observation.md) | Validation rules, quality scoring | Before writing any observation | category-rules |
| 10 | [write-observation](write-observation.md) | Persist observation with auto-validation | After collecting and normalizing product data | validate-observation |
| 11 | [write-answer](write-answer.md) | Compose and persist final answer | All data collection complete | — |
| 12 | [log-step-artifacts](log-step-artifacts.md) | Log tool calls and step artifacts | After every tool call, at step boundaries | — |
| 13 | [retailer-amazon](retailer-amazon.md) | Amazon ASIN, pricing, quirks | Processing Amazon data | — |
| 14 | [retailer-walmart](retailer-walmart.md) | Walmart product IDs, pricing, geo | Processing Walmart data | — |
| 15 | [retailer-target](retailer-target.md) | Target TCIN, Circle offers | Processing Target data | — |
| 16 | [retailer-kroger](retailer-kroger.md) | Kroger product IDs, store pricing | Processing Kroger data | — |
| 17 | [digital-shelf-metrics](digital-shelf-metrics.md) | SOV, price positioning, OOS, assortment | Answering e-commerce intelligence questions | — |
| 18 | [category-rules](category-rules.md) | Per-category validation bounds | Validating observation data | — |

---

## Question-Type to Skills Mapping

| Question Type | Pipeline |
|---|---|
| `best_price` | listing-collection -> detail-collection -> write-observation -> write-answer |
| `price_trend` | listing-collection -> detail-collection -> write-observation -> write-answer |
| `oos_monitor` | listing-collection -> detail-collection -> write-observation -> write-answer |
| `serp_sov` | listing-collection -> write-observation -> write-answer |
| `assortment_coverage` | listing-collection -> write-observation -> write-answer |
| `promotion_scan` | listing-collection -> detail-collection -> write-observation -> write-answer |

All pipelines use `log-step-artifacts` throughout and `normalize-product-data` during parsing. If WSA agents fail at any collection step, `fallback-collection` activates as Tier 2.

---

## Decision Tree

### Fast Path (clear retailer + product)
1. `wsa-agent-selection` — pick SERP agent
2. `listing-collection` — search, parse, dedup, write candidates
3. `wsa-agent-selection` — pick PDP agent
4. `detail-collection` — fetch detail, parse, normalize
5. `write-observation` — persist with auto-validation
6. `write-answer` — compose final answer

### Fallback Path (WSA fails or unavailable)
1. `fallback-collection` — web_search + url_extract
2. Manual parsing with lower confidence
3. `write-observation` — persist with `collection_tier: 'search_extract'`
4. `write-answer` — compose with lower confidence noted

### Retailer-Specific Routing
- Amazon data -> also consult `retailer-amazon`
- Walmart data -> also consult `retailer-walmart`
- Target data -> also consult `retailer-target`
- Kroger data -> also consult `retailer-kroger`

### Validation & Metrics
- All observations -> `validate-observation` + `category-rules`
- SOV/positioning questions -> `digital-shelf-metrics`

---

## Cross-References

- `listing-collection` calls `wsa-agent-selection` to pick the SERP agent
- `detail-collection` calls `wsa-agent-selection` to pick the PDP agent
- `write-observation` auto-calls `validate-observation`
- `validate-observation` uses bounds from `category-rules`
- `fallback-collection` references `nimble-api-reference` for endpoint details
- `sync-wsa-inventory` updates the registry used by `wsa-agent-selection`
- `sync-web-toolbox` checks health of tools used by `fallback-collection`
- All `retailer-*.md` files are consulted by `listing-collection` and `detail-collection` for retailer-specific parsing

---

## Version Tracking

| Skill | Version | Last Updated |
|-------|---------|-------------|
| wsa-agent-selection | 1.0.0 | 2026-03-01 |
| sync-wsa-inventory | 1.0.0 | 2026-03-01 |
| nimble-api-reference | 1.0.0 | 2026-03-01 |
| listing-collection | 1.0.0 | 2026-03-01 |
| detail-collection | 1.0.0 | 2026-03-01 |
| fallback-collection | 1.0.0 | 2026-03-01 |
| sync-web-toolbox | 1.0.0 | 2026-03-01 |
| normalize-product-data | 1.0.0 | 2026-03-01 |
| validate-observation | 1.0.0 | 2026-03-01 |
| write-observation | 1.0.0 | 2026-03-01 |
| write-answer | 1.0.0 | 2026-03-01 |
| log-step-artifacts | 1.0.0 | 2026-03-01 |
| retailer-amazon | 1.0.0 | 2026-03-01 |
| retailer-walmart | 1.0.0 | 2026-03-01 |
| retailer-target | 1.0.0 | 2026-03-01 |
| retailer-kroger | 1.0.0 | 2026-03-01 |
| digital-shelf-metrics | 1.0.0 | 2026-03-01 |
| category-rules | 1.0.0 | 2026-03-01 |
