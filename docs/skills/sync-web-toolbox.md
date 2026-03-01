---
skill: sync-web-toolbox
version: 1.0.0
last_updated: 2026-03-01
owner: agent-dsa
triggers:
  - "before using fallback collection tools"
  - "periodic refresh (daily or on startup)"
  - "after repeated web tool failures"
  - "when Nimble announces new web features"
depends_on:
  - nimble-api-reference
---

## Scope

Refreshing the web toolbox inventory — endpoint health probes, capability snapshots (supported inputs/outputs/options per tool), and persisting the result as an implementation-agnostic artifact.

Does NOT cover: WSA agent health (see `sync-wsa-inventory`), actual data collection (see `fallback-collection`).

## Procedure

### 1. Health Probe

Make a lightweight test call to each web endpoint:

**Web Search:**
```json
POST /v1/search
{ "query": "test", "max_results": 1 }
```
Record: HTTP status, latency_ms, success/failure.

**URL Extract:**
```json
POST /v1/extract
{ "url": "https://example.com", "output_format": "markdown" }
```
Record: HTTP status, latency_ms, success/failure.

### 2. Capability Refresh

Enumerate supported parameters for each tool:

**web_search capabilities:**
```yaml
tool_name: web_search
input_options:
  query: string (required)
  focus: [general, shopping, news, geo, social]
  max_results: integer (1-100)
  include_domains: string[]
  exclude_domains: string[]
  deep_search: boolean
  country: string (ISO country code)
output_fields: [total_results, results, request_id]
```

**url_extract capabilities:**
```yaml
tool_name: url_extract
input_options:
  url: string (required)
  output_format: [html, markdown, simplified_html]
  render: boolean
  driver: string
  country: string (ISO country code)
output_fields: [content, title, description, url, metadata]
```

### 3. Persist Capabilities Snapshot

For each tool, store:
- `tool_name` — identifier (e.g., "web_search", "url_extract")
- `input_options` — supported parameters and allowed values
- `output_fields` — fields returned in responses
- `version_hash` — SHA-256 of the serialized capability set (detects drift)
- `last_verified_at` — ISO timestamp of this check

### 4. Update Health Metrics

Update `agent_health_daily` table with:
- `total_calls` from the last 24 hours
- `successful_calls` / `failed_calls`
- `success_rate` = successful / total
- `pct_fallback` — percentage of total collection calls that used web tools
- `last_failure_reason` if any failures occurred

### 5. Flag Degraded Tools

If `success_rate < 0.8` for a web tool:
- Flag as degraded in health metrics
- Log warning for operational review
- Consider: if both web tools are degraded, the entire Tier 2 fallback path is compromised

## Success Criteria

- [ ] Health probes return current status for both web_search and url_extract
- [ ] Capability snapshots stored with version_hash for drift detection
- [ ] `last_verified_at` updated to current timestamp
- [ ] Degraded tools flagged with descriptive reason
- [ ] Capability drift detected if supported parameters change

## Examples

### Example: Both tools healthy
- web_search: 200 OK, 450ms latency
- url_extract: 200 OK, 1200ms latency
- Capabilities: unchanged from last snapshot (same version_hash)
- Result: both tools marked healthy, snapshot updated

### Example: URL extract degraded
- web_search: 200 OK
- url_extract: success_rate 0.65 over last 24h
- Result: url_extract flagged as degraded, `last_failure_reason: "Intermittent 503 errors"`

## Update Steps

1. If Nimble adds new parameters to web search or URL extract, update the capability schemas
2. If new web tools are added (e.g., screenshot capture), add a new capability block
3. Health threshold (0.8) can be tuned based on operational data
4. Source files: `agent/src/lib/nimble-client.ts` (webSearch, urlExtract), `shared/src/types.ts` (AgentHealthDaily, NimbleWebSearchParams, NimbleUrlExtractParams)
