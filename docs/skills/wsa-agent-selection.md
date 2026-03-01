---
skill: wsa-agent-selection
version: 1.0.0
last_updated: 2026-03-01
owner: agent-dsa
triggers:
  - "when the agent needs to search a retailer's product listings"
  - "when the agent needs to fetch a product detail page"
  - "when selecting which Nimble WSA template to use"
depends_on: []
---

## Scope

How to pick the right Nimble WSA (Web Search Agent) given a retailer and entity type (SERP or PDP).

Does NOT cover: API call mechanics (see `nimble-api-reference`), fallback when no agent exists (see `fallback-collection`).

## WSA Agent Registry

```yaml
agents:
  amazon_serp:
    template_id: 2196
    domain: www.amazon.com
    entity_type: SERP
    input_key: keyword
    optional_params: [zip_code]
    tool: serp_search

  amazon_pdp:
    template_id: 2414
    domain: www.amazon.com
    entity_type: PDP
    input_key: asin
    optional_params: [zip_code]
    tool: pdp_fetch

  walmart_serp:
    template_id: 2627
    domain: www.walmart.com
    entity_type: SERP
    input_key: keyword
    optional_params: [zip_code]
    tool: serp_search

  walmart_pdp:
    template_id: 2411
    domain: www.walmart.com
    entity_type: PDP
    input_key: product_id
    optional_params: [zip_code]
    tool: pdp_fetch

  target_serp:
    template_id: 2068
    domain: www.target.com
    entity_type: SERP
    input_key: keyword
    optional_params: [zip_code]
    tool: serp_search

  target_pdp:
    template_id: 2702
    domain: www.target.com
    entity_type: PDP
    input_key: product_id
    optional_params: [zip_code]
    tool: pdp_fetch

  kroger_serp:
    template_id: 1991
    domain: www.kroger.com
    entity_type: SERP
    input_key: keyword
    optional_params: [zip_code]
    tool: serp_search

  kroger_pdp:
    template_id: 2100
    domain: www.kroger.com
    entity_type: PDP
    input_key: product_id
    optional_params: [zip_code]
    tool: pdp_fetch
```

## Procedure

1. Identify the **retailer domain** (e.g., `www.amazon.com`)
2. Identify the **entity type** needed:
   - `SERP` — searching for products by keyword
   - `PDP` — fetching a specific product's detail page
3. Look up the agent in the registry by `(domain, entity_type)`
4. Note the **input_key**:
   - SERP agents always use `keyword`
   - PDP agents use `asin` (Amazon) or `product_id` (all others)
5. If a zip code is available and the retailer supports location, pass it as `zip_code`
6. Call the appropriate tool (`serp_search` or `pdp_fetch`) with the agent name

### Selection Logic
```
if entity_type == SERP:
    agent_name = "{retailer}_serp"
    param = { keyword: search_term }
elif entity_type == PDP:
    agent_name = "{retailer}_pdp"
    if retailer == "amazon":
        param = { product_id: asin }
    else:
        param = { product_id: product_id }
```

## Success Criteria

- [ ] Correct agent selected for retailer + entity type combination
- [ ] Input key matches the agent's expected parameter name
- [ ] Zip code passed when available and retailer supports location
- [ ] If no matching agent exists, fallback to `fallback-collection`

## Examples

### Example: Search Amazon for "Cheerios"
- Retailer: `www.amazon.com`, Entity: `SERP`
- Agent: `amazon_serp` (template 2196)
- Tool call: `serp_search({ agent_name: "amazon_serp", keyword: "Cheerios" })`

### Example: Fetch Walmart product detail
- Retailer: `www.walmart.com`, Entity: `PDP`
- Agent: `walmart_pdp` (template 2411)
- Tool call: `pdp_fetch({ agent_name: "walmart_pdp", product_id: "123456789", zip_code: "60601" })`

### Example: No agent available
- Retailer: `www.costco.com`, Entity: `SERP`
- No match in registry -> trigger `fallback-collection`

## Update Steps

1. When Nimble adds a new WSA agent, add an entry to the YAML registry above
2. When a template ID changes, update the `template_id` field
3. Run `sync-wsa-inventory` to verify the updated registry matches Nimble's API
4. Source of truth: `supabase/seed.sql` (nimble_agents insert) + `agent/src/lib/nimble-client.ts`
