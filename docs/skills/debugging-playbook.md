---
skill: debugging-playbook
version: 1.0.0
last_updated: 2026-03-02
owner: agent-dsa
triggers:
  - "when SERP results are empty or unexpected"
  - "when debugging Nimble API integration issues"
  - "when data is missing or malformed"
depends_on:
  - nimble-api-reference
  - wsa-response-reference
---

## Scope

Step-by-step debugging methodology for the agent-dsa data pipeline. Based on patterns proven during the cereal category sweep session.

## Step 1: Create a Minimal Repro Script

Create a standalone script in `/tmp/` to isolate the issue:

```typescript
// /tmp/debug-nimble.ts
import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

import { getNimbleClient } from './agent/src/lib/nimble-client.js';

async function main() {
  const nimble = getNimbleClient();
  const resp = await nimble.runSearchAgent({
    agent_name: 'walmart_serp',
    keyword: 'Cheerios cereal',
    zip_code: '75201',
  });
  console.log(JSON.stringify(resp, null, 2).slice(0, 2000));
}
main().catch(console.error);
```

**Key:** Use `dotenv.config({ path: resolve(..., '.env.local') })` — dotenv does NOT auto-detect `.env.local`.

## Step 2: Log the Raw Response Shape

```typescript
console.log('Top-level keys:', Object.keys(resp));
console.log('typeof resp.data:', typeof resp.data);
if (resp.data && typeof resp.data === 'object') {
  const d = resp.data as Record<string, unknown>;
  console.log('data keys:', Object.keys(d));
  console.log('data.parsing exists:', !!d.parsing);
  console.log('Array.isArray(data.parsing):', Array.isArray(d.parsing));
  console.log('data.parsed_items exists:', !!d.parsed_items);
  console.log('data.results exists:', !!d.results);
}
```

## Step 3: Check the Extraction Path

```typescript
import { extractSerpItems, parseSerpResults } from './agent/src/lib/parsers.js';

const rawItems = extractSerpItems(resp);
console.log('Raw items extracted:', rawItems.length);
if (rawItems.length > 0) {
  console.log('First item keys:', Object.keys(rawItems[0] as object));
  console.log('First item:', JSON.stringify(rawItems[0], null, 2));
}

const parsed = parseSerpResults(rawItems);
console.log('Parsed results:', parsed.length);
```

## Step 4: Verify Field Mapping

```typescript
// Check that parseSerpResults field mapping matches actual item keys
const item = rawItems[0] as Record<string, unknown>;
console.log('Has product_name:', !!item.product_name);
console.log('Has title:', !!item.title);
console.log('Has product_url:', !!item.product_url);
console.log('Has price:', item.price, typeof item.price);
console.log('Has product_price:', item.product_price, typeof item.product_price);
```

## Step 5: Common Gotchas Checklist

| Issue | Symptom | Fix |
|-------|---------|-----|
| Wrong dotenv path | All env vars undefined | Use `dotenv.config({ path: resolve(__dirname, '../../.env.local') })` |
| `data.parsing` vs `data.parsed_items` | 0 items extracted | Use `extractSerpItems()` which checks both paths |
| Array-that-looks-like-object | `parsing` is `{ "0": {...}, "1": {...} }` | `Object.values()` handles this |
| Supabase pagination | Only 1000 rows returned | Add `.range(0, count)` or paginate |
| Circuit breaker tripped | All subsequent calls skipped | Check `isCircuitOpen()`, increase threshold if too aggressive |
| Kroger 400 errors | Bad Request from WSA agent | Kroger WSA agent (template 1991) may need different params |

## Supabase Debugging

```typescript
// Check row count (default limit is 1000)
const { count } = await db
  .from('observations')
  .select('*', { count: 'exact', head: true })
  .eq('run_id', runId);
console.log('Total rows:', count);

// Paginate if needed
const PAGE_SIZE = 1000;
for (let offset = 0; offset < count; offset += PAGE_SIZE) {
  const { data } = await db
    .from('observations')
    .select('*')
    .eq('run_id', runId)
    .range(offset, offset + PAGE_SIZE - 1);
}
```

## Update Steps

1. Add new gotchas as they're discovered in debugging sessions
2. Source files referenced: `agent/src/lib/parsers.ts`, `agent/src/lib/nimble-client.ts`, `agent/src/lib/retry.ts`
