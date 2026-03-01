---
skill: log-step-artifacts
version: 1.0.0
last_updated: 2026-03-01
owner: agent-dsa
triggers:
  - "after every tool call (via post-tool-use hook)"
  - "at step boundaries for summary metrics"
depends_on: []
---

## Scope

Recording every tool invocation (inputs/outputs) and computing step-level summaries (coverage %, counts, fallback tier usage) for observability and debugging.

Does NOT cover: Data collection logic (see collection skills), validation (see `validate-observation`).

## Procedure

### 1. Raw Tool Logging (Post-Tool-Use Hook)

After every tool call, the logging hook captures:

```typescript
{
  run_id: string;         // Current run
  session_id: string;     // Agent session
  tool_name: string;      // e.g., "serp_search", "pdp_fetch"
  tool_input: object;     // Full input params
  tool_output: object;    // Full output (or truncated if large)
}
```

**Implementation:**
- Hook registered via `createLoggingHook(runId)` with the Claude Agent SDK
- Fires on `PostToolUse` event
- Insert to `agent_logs` table
- **Fire-and-forget** — does not await, never blocks agent execution
- Errors in logging are caught and swallowed silently

### 2. Step Summaries (At Step Boundaries)

At each logical step boundary (e.g., after all SERP searches, after all PDP fetches), compute:

| Metric | Description | Computation |
|--------|-------------|-------------|
| `coverage_pct` | % of target retailers/products successfully scraped | `successful / total_targets * 100` |
| `candidate_count` | Total SERP candidates found | Count from `serp_candidates` for this run |
| `observation_count` | Total observations written | Count from `observations` for this run |
| `validation_breakdown` | Pass/warn/fail counts | Group observations by `validation_status` |
| `tier_usage` | % Tier 1 (WSA) vs Tier 2 (search+extract) | Group by `collection_tier` |

### 3. Fire-and-Forget Pattern

```typescript
// Logging never blocks execution
try {
  supabase.from('agent_logs').insert({...}).then(() => {})
} catch {
  // Swallow — logging failures must never break the agent
}
```

## Log Schema

### `agent_logs` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `run_id` | uuid | FK to runs |
| `session_id` | string | Agent session identifier |
| `tool_name` | string | Tool that was called |
| `tool_input` | jsonb | Input parameters |
| `tool_output` | jsonb | Output data |
| `reasoning` | text | Agent reasoning (if captured) |
| `token_usage` | jsonb | Token counts |
| `cost_usd` | numeric | Cost of this call |
| `duration_ms` | integer | Time taken |
| `created_at` | timestamp | When logged |

### `run_steps` Table (Step Summaries)

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `run_id` | uuid | FK to runs |
| `step_type` | enum | `'serp'`, `'pdp'`, `'category'`, `'validation'`, `'aggregation'` |
| `retailer_id` | uuid | FK to retailers (optional) |
| `status` | enum | Run status |
| `started_at` | timestamp | Step start |
| `finished_at` | timestamp | Step end |
| `request_count` | integer | Total API calls |
| `success_count` | integer | Successful calls |
| `failure_count` | integer | Failed calls |
| `summary` | jsonb | Step-level metrics |

## Success Criteria

- [ ] Every tool call has a corresponding `agent_logs` entry
- [ ] Step summaries capture coverage %, tier usage, and validation breakdown
- [ ] Logging failures never break agent execution
- [ ] Fire-and-forget pattern used consistently (no awaiting log inserts)
- [ ] Logs include enough context to reconstruct the agent's decision path

## Examples

### Example: Tool call log entry
```json
{
  "run_id": "abc-123",
  "session_id": "sess-456",
  "tool_name": "serp_search",
  "tool_input": {
    "agent_name": "walmart_serp",
    "keyword": "Cheerios",
    "zip_code": "60601"
  },
  "tool_output": {
    "success": true,
    "result_count": 10
  },
  "duration_ms": 45000
}
```

### Example: Step summary
```json
{
  "step_type": "serp",
  "summary": {
    "coverage_pct": 100,
    "candidate_count": 38,
    "retailers_attempted": 4,
    "retailers_succeeded": 4,
    "tier_usage": { "wsa": 100, "search_extract": 0 }
  }
}
```

## Update Steps

1. If new tools are added, they are automatically logged by the hook (no changes needed)
2. If new step summary metrics are needed, add them to the summary computation
3. Source files: `agent/src/hooks/logging-hook.ts` (createLoggingHook), `shared/src/types.ts` (AgentLog, RunStep)
