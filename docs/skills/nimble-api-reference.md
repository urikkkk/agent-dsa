---
skill: nimble-api-reference
version: 1.0.0
last_updated: 2026-03-01
owner: agent-dsa
triggers:
  - "when making any Nimble API call"
  - "when debugging Nimble API errors"
  - "when configuring timeouts or retry behavior"
depends_on: []
---

## Scope

Quick reference for Nimble API endpoints, authentication, timeouts, error codes, and retry strategy.

Does NOT cover: Which agent to use (see `wsa-agent-selection`), response parsing (see `listing-collection`, `detail-collection`).

## Base Configuration

```yaml
base_url: ${NIMBLE_API_BASE_URL} || "https://sdk.nimbleway.com"
auth: "Bearer ${NIMBLE_API_KEY}"
content_type: "application/json"
```

## Endpoints

| Endpoint | Method | Purpose | Timeout |
|----------|--------|---------|---------|
| `/v1/agents/run` | POST | Execute a WSA agent (SERP or PDP) | 120s |
| `/v1/agents/list` | GET | List all available WSA templates | 30s |
| `/v1/agents/get?template_name={name}` | GET | Get details for a specific agent | 30s |
| `/v1/search` | POST | Web search (Tier 2 fallback) | 60s |
| `/v1/extract` | POST | URL content extraction (Tier 2 fallback) | 60s |

## Request Shapes

### POST /v1/agents/run
```json
{
  "agent": "amazon_serp",
  "params": {
    "keyword": "Cheerios",
    "zip_code": "60601",
    "zipcode": "60601"
  }
}
```
Note: Both `zip_code` and `zipcode` are sent to accommodate retailer variations.

**Response:** `{ url, task_id, status, data: { parsed_items: [...] } }`

### POST /v1/search
```json
{
  "query": "Cheerios cereal site:walmart.com",
  "focus": "shopping",
  "max_results": 10,
  "include_domains": ["walmart.com"],
  "deep_search": false,
  "country": "US"
}
```
Focus modes: `general`, `shopping`, `news`, `geo`, `social`

**Response:** `{ total_results, results: [...], request_id? }`

### POST /v1/extract
```json
{
  "url": "https://www.walmart.com/ip/123456",
  "output_format": "markdown",
  "render": false,
  "country": "US"
}
```
Output formats: `html`, `markdown`, `simplified_html`

**Response:** `{ content, title, description, url, metadata? }`

## Timeout Values

| Context | Timeout | Rationale |
|---------|---------|-----------|
| WSA agent (SERP/PDP) | 120,000ms | Agents can take 10-120s to scrape |
| Web search | 60,000ms | Search API is faster |
| URL extract | 60,000ms | Extract with optional rendering |
| Default/other | 30,000ms | List/get operations |

## Error Codes

| HTTP Status | Meaning | Action |
|-------------|---------|--------|
| 429 | Rate limited | Retry with exponential backoff |
| 500 | Server error | Retry (transient) |
| 503 | Service unavailable | Retry, then fallback to Tier 2 |
| 400 | Bad request | Do not retry — fix request params |
| 401 | Unauthorized | Check NIMBLE_API_KEY |
| 404 | Not found | Agent/template does not exist |

Custom error class: `NimbleApiError { statusCode, message, responseBody }`

## Retry Strategy

```yaml
default:
  max_attempts: 3
  base_delay_ms: 1000
  max_delay_ms: 10000
  jitter_ms: 500

serp_and_pdp:
  max_attempts: 2
  base_delay_ms: 3000
  max_delay_ms: 15000

web_and_extract:
  max_attempts: 2
  base_delay_ms: 1000
  max_delay_ms: 10000
```

**Backoff formula:**
```
delay = min(base_delay * 2^(attempt-1) + random(-jitter, +jitter), max_delay)
```

**RetryResult shape:**
```typescript
{ success: boolean, data?: T, attempts: number, errors: Array<{ attempt, error, backoffMs }> }
```

## Success Criteria

- [ ] Correct endpoint used for the operation type
- [ ] Auth header set with valid Bearer token
- [ ] Timeout matches the endpoint type
- [ ] Retryable errors (429, 500, 503) trigger retry with backoff
- [ ] Non-retryable errors (400, 401) fail immediately

## Examples

### Example: Successful WSA call
- POST `/v1/agents/run` with `agent: "amazon_serp"`, `params: { keyword: "Cheerios" }`
- Response 200: `{ data: { parsed_items: [...] } }`

### Example: Rate limited then success
- Attempt 1: 429 -> wait 3000ms + jitter
- Attempt 2: 200 -> success
- RetryResult: `{ success: true, attempts: 2, errors: [{ attempt: 1, error: "429", backoffMs: 3200 }] }`

## Update Steps

1. If Nimble adds new endpoints, add them to the table
2. If timeout values need tuning, update based on P99 latency data
3. Source files: `agent/src/lib/nimble-client.ts`, `agent/src/lib/retry.ts`
