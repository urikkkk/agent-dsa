---
skill: wsa-response-reference
version: 1.0.0
last_updated: 2026-03-02
owner: agent-dsa
triggers:
  - "when debugging WSA response parsing"
  - "when adding a new WSA agent"
  - "when response items are empty or missing"
depends_on:
  - nimble-api-reference
---

## Scope

Consolidated reference for Nimble WSA (Website Search Agent) response formats. Covers the actual response shape per agent type, field mapping, and common parsing pitfalls.

## WSA SERP Response Shape

```typescript
// POST /v1/agents/run → Response for SERP agents
{
  url: string,           // The URL that was scraped
  task_id: string,       // Nimble task identifier
  status: string,        // "completed" | "failed"
  data: {
    html: string,        // Raw HTML (large, usually ignored)
    parsing: [           // ARRAY of product objects — this is the primary path
      {
        product_name: string,
        product_price: number,
        product_url: string,
        position: number,
        is_sponsored: boolean,
        asin?: string,           // Amazon only
        product_id?: string,     // Walmart/Target
        rating?: number,
        review_count?: number,
        product_rating?: number, // Alternative field name
        product_reviews_count?: number,
        badge?: string,
        amazons_choice?: boolean,
      }
    ],
    headers: object,     // HTTP headers from the scraped page
  }
}
```

## WSA PDP Response Shape

```typescript
// POST /v1/agents/run → Response for PDP agents
{
  url: string,
  task_id: string,
  status: string,
  data: {
    html: string,
    parsing: {
      product_title: string,
      brand?: string,
      web_price?: number,
      price?: number,
      shelf_price?: number,
      promo_price?: number,
      list_price?: number,
      pack_size?: string,
      size?: string,
      unit_price?: number,
      price_per_unit?: number,
      availability?: boolean,
      in_stock?: boolean,
      product_out_of_stock?: boolean,
      average_of_reviews?: number,
      number_of_reviews?: number,
      variants?: unknown[],
      product_url: string,
    },
    headers: object,
  }
}
```

## Extraction Logic

Use `extractSerpItems()` from `agent/src/lib/parsers.ts`:

```typescript
import { extractSerpItems, parseSerpResults } from './lib/parsers.js';

const rawItems = extractSerpItems(responseData);  // unknown[]
const parsed = parseSerpResults(rawItems);         // NimbleSerpResult[]
```

**Extraction priority order:**
1. `data.parsing` — primary path (array of product objects)
2. `data.parsed_items` — legacy fallback
3. `data.results` — alternative format
4. `data` as top-level array — edge case

## Field Mapping Table (SERP)

| WSA Field | Our Normalized Field | Notes |
|-----------|---------------------|-------|
| `product_name` / `title` / `name` | `title` | First non-empty wins |
| `product_url` / `url` / `link` | `url` | |
| `price` / `product_price` | `price` | Cast to number |
| `position` / `rank` | `rank` | Falls back to array index + 1 |
| `is_sponsored` / `sponsored` / `is_ad` | `is_sponsored` | Boolean coercion |
| `asin` / `product_id` | `retailer_product_id` | |
| `rating` / `product_rating` | `rating` | |
| `review_count` / `product_reviews_count` | `review_count` | |
| `badge` / `amazons_choice` | `badge` | |

## Common Pitfalls

1. **`data.parsing` is an array, not an object** — despite sometimes appearing as `{ "0": {...}, "1": {...} }` in raw JSON. The shared utility handles both formats with `Object.values()` fallback.

2. **`data.parsed_items` is NOT the primary path** — early code assumed this but it's empty for most WSA agents. Always check `data.parsing` first.

3. **Price can be in multiple fields** — `price`, `product_price`, `web_price`. The parser tries all of them.

4. **SERP data has no size info** — Don't run size-dependent validation checks on WSA/SERP-tier data. Size parsing only works on PDP responses.

5. **Array vs object parsing** — If `data.parsing` is an object with numeric keys (e.g., `{"0": {...}, "1": {...}}`), use `Object.values()` to convert to array.

## Debug Recipe

When SERP results come back empty:

```typescript
// 1. Log the raw response shape
const resp = await nimble.runSearchAgent({ agent_name, keyword, zip_code });
console.log('Top-level keys:', Object.keys(resp));
console.log('typeof resp.data:', typeof resp.data);

// 2. Check data shape
if (resp.data && typeof resp.data === 'object') {
  const d = resp.data as Record<string, unknown>;
  console.log('data keys:', Object.keys(d));
  console.log('parsing exists:', !!d.parsing);
  console.log('parsing is array:', Array.isArray(d.parsing));
  console.log('parsed_items exists:', !!d.parsed_items);
}

// 3. Extract with shared utility
const items = extractSerpItems(resp);
console.log('Extracted items:', items.length);
```

## Update Steps

1. If Nimble changes the WSA response format, update the response shapes above
2. If new field aliases appear, update `parseSerpResults()` in `agent/src/lib/parsers.ts`
3. Source files: `agent/src/lib/parsers.ts`, `agent/src/tools/serp-search.ts`
