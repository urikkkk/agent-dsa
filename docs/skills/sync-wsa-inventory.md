---
skill: sync-wsa-inventory
version: 1.0.0
last_updated: 2026-03-01
owner: agent-dsa
triggers:
  - "when running a periodic health check on WSA agents"
  - "when a WSA agent call fails unexpectedly"
  - "on system startup or deployment"
  - "when Nimble announces new or changed agents"
depends_on:
  - wsa-agent-selection
---

## Scope

Refreshing the WSA agent registry — checking which agents are healthy, updating template IDs, detecting new agents, and flagging unhealthy ones.

Does NOT cover: Selecting which agent to use (see `wsa-agent-selection`), web tool health (see `sync-web-toolbox`).

## Procedure

1. **Fetch current agent list from Nimble**
   ```
   GET /v1/agents/list
   ```
   Response: array of templates (or `data.templates` depending on shape)

2. **For each known agent in local registry** (`nimble_agents` table):
   - Check if the agent's `template_id` appears in the Nimble response
   - If found: mark `is_healthy: true`, update `last_seen_at` to now
   - If NOT found: mark `is_healthy: false`, set `status_note` with reason

3. **Detect new agents** not in local registry:
   - Log for manual review (do not auto-add — requires mapping to retailer)

4. **Get detailed info for each agent** (optional, for capability drift):
   ```
   GET /v1/agents/get?template_name={name}
   ```
   Compare capabilities (input/output schema) against stored `capabilities` JSON

5. **Update `agent_health_daily`** table:
   - Record `total_calls`, `successful_calls`, `failed_calls`, `success_rate`
   - Compute `pct_wsa` and `pct_fallback` from recent run data
   - Set `last_failure_reason` if applicable

6. **Flag degraded agents**:
   - If `success_rate < 0.8` over the last 24h, set `is_healthy: false`
   - Record `status_note` with failure pattern

## Success Criteria

- [ ] `nimble_agents.is_healthy` reflects current Nimble API state
- [ ] `nimble_agents.last_seen_at` updated for all reachable agents
- [ ] Unhealthy agents flagged with descriptive `status_note`
- [ ] `agent_health_daily` row created for today with accurate metrics
- [ ] New/unknown agents logged for review

## Examples

### Example: All agents healthy
- `listAgents()` returns 8 templates matching all local agents
- All 8 agents updated: `is_healthy: true`, `last_seen_at: now()`
- `agent_health_daily`: all agents show `success_rate >= 0.8`

### Example: Walmart PDP agent missing
- `listAgents()` returns 7 templates — `walmart_pdp` (2411) not found
- `walmart_pdp` updated: `is_healthy: false`, `status_note: "Template 2411 not found in Nimble API response"`
- Downstream: `wsa-agent-selection` will route Walmart PDP to `fallback-collection`

## Update Steps

1. If Nimble changes their `/v1/agents/list` response format, update parsing logic
2. Health thresholds (currently `success_rate < 0.8`) can be tuned based on operational experience
3. Source files: `agent/src/lib/nimble-client.ts` (listAgents, getAgent), `shared/src/types.ts` (NimbleAgent, AgentHealthDaily)
