# Contributing to Agent DSA

## Development Setup

```bash
git clone https://github.com/urikkkk/agent-dsa.git
cd agent-dsa
npm install
cp .env.example .env.local
# Fill in API keys in .env.local
```

## Project Structure

```
agent/src/
├── agents/          # Prompt builders (webops-prompt.ts, dsa-prompt.ts)
├── hooks/           # PostToolUse hooks (logging-hook.ts)
├── lib/             # Core libraries
│   ├── ledger.ts    # Observability primitives
│   ├── retry.ts     # Retry + circuit breaker
│   ├── nimble-client.ts  # Nimble API wrapper
│   ├── parsers.ts   # SERP/PDP response parsers
│   ├── normalize.ts # Size/URL/ID normalization
│   └── supabase.ts  # Database client
├── tools/           # MCP tool definitions
│   ├── serp-search.ts, pdp-fetch.ts       # Tier 1 (WSA)
│   ├── web-search.ts, url-extract.ts      # Tier 2 (fallback)
│   ├── write-results.ts, dedup.ts         # Data write
│   ├── read-observations.ts, read-candidates.ts  # Data read (DSA)
│   ├── read-config.ts, find-template.ts   # Metadata
│   └── index.ts     # Tool server factories
├── execute-question.ts  # Two-phase orchestrator
└── cli.ts           # CLI entry point
```

## Two-Agent Architecture

The system runs two isolated agents per question:

1. **WebOps** — collects data from retailers (SERP/PDP/fallback tools)
2. **DSA** — analyzes collected data and writes the answer (read/write tools)

Each agent has its own MCP tool server. Tool-door isolation is enforced — the WebOps agent cannot access DSA tools and vice versa. Violations are logged as `tool_door_violation` events.

## Adding a New Tool

1. Create the tool in `agent/src/tools/your-tool.ts` using the `tool()` helper
2. Register it in the correct server in `agent/src/tools/index.ts`:
   - Collection tools → `createWebOpsToolServer()`
   - Analysis tools → `createDsaAnalysisToolServer()`
3. Add to `ALLOWED_TOOLS` in `agent/src/hooks/logging-hook.ts`
4. For collection tools, add ledger instrumentation:
   - `generateTaskId()` + `getAttemptNumber()` at the top
   - `isCircuitOpen()` check before external API calls
   - `emitLedgerEvent({ status: 'started' })` before execution
   - The PostToolUse hook handles `completed`/`failed` events automatically
5. Update types in `shared/src/types.ts` if new interfaces are needed
6. Verify: `npx tsc -p agent/tsconfig.json --noEmit`

## Adding a Database Migration

1. Create `supabase/migrations/NNN_description.sql`
2. Follow the numbering convention (001, 002, 003, ...)
3. Include indexes for frequently queried columns
4. Keep migrations backward-compatible (additive, not destructive)
5. Test with `supabase db reset` locally

## Observability Conventions

- Every external API call should have a `started` → `completed`/`failed` event pair
- Use `generateTaskId(runId, retailerId, operation, keyword, location?)` for deterministic task IDs
- Artifacts are stored with SHA-256 dedup — duplicate payloads share a single row
- Step summaries are computed after each agent phase completes
- The watchdog resolves stuck tasks (started without terminal event after 120s)
- Circuit breakers trip after 3 consecutive failures per `retailer:tool` key

## Verification

Before submitting a PR:

```bash
# TypeScript compilation
npx tsc -p agent/tsconfig.json --noEmit

# End-to-end test
npm run agent:cli "Best price for Cheerios on Amazon"

# Check ledger output
# SELECT * FROM ledger_events WHERE run_id = '...' ORDER BY created_at;
```

## Commit Messages

Follow the existing style:

```
<verb> <what> <where/why>

<details if needed>

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

Examples:
- `Add two-agent orchestration and observability ledger system`
- `Fix circuit breaker cooldown not resetting on success`
- `Add Instacart retailer with SERP/PDP agent templates`
