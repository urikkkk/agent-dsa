# Agent DSA

AI-powered e-commerce intelligence platform that collects product data (prices, availability, ratings, promotions) from major retailers and answers competitive positioning questions. Built for General Mills using Claude AI agents and Nimble web scraping.

## How It Works

A natural language question like _"Best price for Cheerios across Amazon and Walmart in Chicago"_ triggers a two-phase agent pipeline:

### Phase 1: WebOps Collection (up to 20 turns)
A WebOps agent collects raw data from retailers using an optimized decision tree:

**Fast Path** (retailer + product known):
1. `serp_search` — find matching products on the retailer SERP
2. `pdp_fetch` — get structured pricing from product detail pages
3. `write_observation` — auto-validates and persists in one call

**Discovery Path** (ambiguous query): reads config first, then follows the fast path.
**Fallback Path** (WSA agent unavailable): uses `web_search_fallback` + `url_extract_fallback`.

### Phase 2: DSA Analysis (up to 10 turns)
A separate analysis agent reads the collected data, computes the answer, and writes it:
1. `read_observations` / `read_candidates` — load collected data
2. `read_config` — query retailer/product metadata
3. `write_answer` — store the confidence-scored answer with sources

Each phase runs in its own MCP tool server with strict **tool-door isolation** — the WebOps agent cannot write answers, and the DSA agent cannot call Nimble APIs.

## Architecture

```
┌──────────────┐
│  CLI / Web   │
│  (question)  │
└──────┬───────┘
       │
       v
┌──────────────────────────────────────────────────────────┐
│                    Orchestrator                           │
│                 (execute-question.ts)                     │
│                                                          │
│  ┌─────────────────────┐    ┌──────────────────────┐     │
│  │  Phase 1: WebOps    │    │  Phase 2: DSA        │     │
│  │  (collection)       │    │  (analysis)          │     │
│  │                     │    │                      │     │
│  │  serp_search        │    │  read_config         │     │
│  │  pdp_fetch          │    │  read_observations   │     │
│  │  web_search_fallback│    │  read_candidates     │     │
│  │  url_extract_fallback    │  write_answer        │     │
│  │  write_observation  │    │                      │     │
│  │  write_serp_cands   │    └──────────┬───────────┘     │
│  └──────────┬──────────┘               │                 │
│             │                          │                 │
│             v                          v                 │
│  ┌─────────────────────────────────────────────────┐     │
│  │           Observability Ledger                   │     │
│  │  ledger_events · ledger_artifacts · run_steps    │     │
│  │  circuit breaker · watchdog · step summaries     │     │
│  └─────────────────────────────────────────────────┘     │
└──────────────────────┬───────────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          v                         v
   ┌──────────────┐         ┌──────────────┐
   │   Supabase   │         │  Nimble WSA  │
   │  (Postgres)  │         │  (scraping)  │
   └──────────────┘         └──────────────┘
```

**Monorepo layout:**

```
agent-dsa/
├── agent/           # Agent executor — tools, prompts, ledger, Nimble client
│   └── src/
│       ├── agents/  # WebOps + DSA prompt builders
│       ├── hooks/   # PostToolUse logging hook (ledger-aware)
│       ├── lib/     # Nimble client, retry, ledger, parsers, normalize
│       └── tools/   # Tool definitions (collection, analysis, write)
├── docs/skills/     # 18 reusable skill procedures + index (domain knowledge)
├── shared/          # Shared TypeScript types
├── web/             # Web frontend (Next.js)
└── supabase/        # Database migrations and seed data
```

## Tech Stack

- **AI Runtime:** Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) with Claude Sonnet 4.6
- **Web Scraping:** Nimble WSA (Website Search Agents) for structured e-commerce data
- **Database:** Supabase (PostgreSQL 17)
- **Language:** TypeScript (strict mode, Zod validation)
- **Package Manager:** npm workspaces

## Supported Retailers

| Retailer | SERP Agent | PDP Agent |
|----------|-----------|-----------|
| Amazon   | #2196     | #2414     |
| Walmart  | #2627     | #2411     |
| Target   | #2068     | #2702     |
| Kroger   | #1991     | #2100     |

## Quick Start

### Prerequisites

- Node.js 18+
- [Supabase](https://supabase.com) project
- [Anthropic API key](https://console.anthropic.com)
- [Nimble API key](https://nimbleway.com)

### Setup

```bash
# Clone and install
git clone https://github.com/urikkkk/agent-dsa.git
cd agent-dsa
npm install

# Configure environment
cp .env.example .env.local
```

Add your keys to `.env.local`:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Nimble
NIMBLE_API_KEY=your-nimble-key
NIMBLE_API_BASE_URL=https://sdk.nimbleway.com

# Agent config (optional)
AGENT_MODEL=claude-sonnet-4-6
WEBOPS_MAX_TURNS=20
DSA_MAX_TURNS=10
```

### Database Setup

```bash
npm run db:push    # Apply migrations (3 migration files, 24 tables)
npm run db:seed    # Load seed data (4 retailers, 12 products, 3 locations)
```

### Run

```bash
# Polling daemon — watches for pending runs in Supabase
npm run agent

# One-off question via CLI
npm run agent:cli "Best price for Cheerios in Chicago"
```

## Agent Tools

Tools are organized into two isolated MCP servers with strict tool-door enforcement:

### WebOps Tool Server (collection phase)

| Tool | Tier | Description |
|------|------|-------------|
| `serp_search` | WSA | Search retailer product listings via Nimble WSA agents |
| `pdp_fetch` | WSA | Fetch structured product detail page (price, stock, ratings) |
| `web_search_fallback` | Fallback | General web search when WSA is unavailable |
| `url_extract_fallback` | Fallback | Extract content from arbitrary URLs |
| `find_wsa_template` | Meta | Discover available Nimble WSA agents for a retailer |
| `write_observation` | Write | Auto-validates and stores a price/availability data point |
| `write_serp_candidates` | Write | Store ranked search result listings |
| `dedup_and_write` | Write | Deduplicate and persist SERP results in one call |

### DSA Tool Server (analysis phase)

| Tool | Description |
|------|-------------|
| `read_config` | Query config tables (locations, retailers, products) |
| `read_observations` | Read collected observations for analysis |
| `read_candidates` | Read SERP candidates for analysis |
| `write_answer` | Store the final computed answer |

Tool-door violations are detected and logged as `tool_door_violation` events in the ledger.

## Observability & Ledger System

Every tool call, retry, and failure is tracked in a structured, append-only ledger:

### Event Lifecycle

Each data-collection task follows a `started` → `completed`/`failed` lifecycle:

```
serp_search("Cheerios", amazon)
  ├── started  (span_id=A, attempt=1)
  ├── failed   (parent_span_id=A, attempt=1, error=timeout, hint=retry)
  ├── started  (span_id=B, attempt=2)
  └── completed(parent_span_id=B, attempt=2)
```

### Components

| Component | Purpose |
|-----------|---------|
| `ledger_events` | Append-only event log (started/completed/failed/skipped per task) |
| `ledger_artifacts` | Raw I/O storage with SHA-256 deduplication |
| `run_steps` | Step-level summaries with coverage %, fallback rate, error clusters |
| Circuit breaker | In-memory per `retailer:tool`, opens after 3 consecutive failures, 60s cooldown |
| Watchdog | Detects stuck tasks (started but no terminal event after 120s) |
| Completion criteria | Run marked complete only when all steps summarized, no stuck tasks, answer exists |

### Step Summaries

After each agent phase, the orchestrator computes and persists a `StepSummary`:

```
[collecting] summary: 8/10 tasks, 80% coverage
[analyzing]  summary: 4/4 tasks, 100% coverage
```

Summaries include: `total_tasks`, `completed`, `failed`, `skipped`, `coverage_pct`, `fallback_rate`, `validation_breakdown`, `error_clusters`, and `rerun_plan`.

### Debugging

```typescript
import { getRunDebugData } from './lib/ledger';
const debug = await getRunDebugData(runId);
// Returns: { events, artifacts, summaries, retryHistory }
// retryHistory groups events by task_id showing full attempt chains
```

## Data Validation

Every observation is **auto-validated** inside `write_observation` with category-specific checks:

- Price is positive and within bounds (e.g., cereal: $0.50 - $30)
- Promo price < shelf price
- Size parses correctly (supports oz, lb, g, kg, multi-packs)
- Unit price is consistent (price / size within 10%)
- Source URL domain matches retailer
- Rating within 0-5 range
- Confidence within 0-1 range

Each check produces a quality score (0.3 fail / 0.7 warn / 1.0 pass). Validation results are returned inline with the write response.

## Question Templates

| Template | Purpose |
|----------|---------|
| `best_price` | Find the lowest price across retailers |
| `price_trend` | Track price changes over time |
| `oos_monitor` | Monitor out-of-stock status |
| `serp_sov` | Share of voice in search results |
| `assortment_coverage` | Check product availability by retailer |
| `promotion_scan` | Detect active promotions and deals |

## Database Schema

24 tables across 3 migrations:

- **Config** — `locations`, `retailers`, `nimble_agents`, `products`, `product_matches`
- **Workflow** — `question_templates`, `keyword_sets`, `runs`, `answers` (unique per run)
- **Data** — `serp_candidates`, `observations` (deduplicated per run+retailer+product+location), `run_steps`
- **API Tracking** — `nimble_requests`, `nimble_responses`, `fallback_events`
- **Quality** — `validation_results`, `run_errors`, `agent_health_daily`
- **Observability** — `ledger_events` (append-only), `ledger_artifacts` (SHA-256 dedup), `agent_logs` (legacy)
- **Admin** — `subscriptions`, `audit_events`

The `agent_logs_v2` view provides backward compatibility, mapping ledger events to the legacy `agent_logs` shape.

## Scripts

```bash
npm run agent          # Start polling daemon
npm run agent:cli      # Run single question from CLI
npm run db:push        # Push migrations to Supabase
npm run db:seed        # Load seed data
```

## Seed Data

The seed includes:

- **4 retailers** — Amazon, Walmart, Target, Kroger (with SERP/PDP agent IDs)
- **3 locations** — Chicago IL, Minneapolis MN, New York NY
- **12 products** — General Mills cereals and snacks (Cheerios, Nature Valley, etc.)
- **6 question templates** — Covering pricing, trends, stock, SERP, assortment, promotions
- **Keyword sets** — Core cereal and snack search terms

## Knowledge-Base Skills

The agent's domain knowledge is organized as 18 small, reusable skill procedures in `docs/skills/`. Each skill has a focused scope, clear triggers, step-by-step procedure, success criteria, and examples. The skills index is injected into the system prompt at build time.

| Category | Skills |
|----------|--------|
| **Nimble API** | `wsa-agent-selection`, `sync-wsa-inventory`, `nimble-api-reference` |
| **Data Collection** | `listing-collection`, `detail-collection`, `fallback-collection`, `sync-web-toolbox` |
| **Data Processing** | `normalize-product-data`, `validate-observation`, `write-observation`, `write-answer`, `log-step-artifacts` |
| **Retailer Profiles** | `retailer-amazon`, `retailer-walmart`, `retailer-target`, `retailer-kroger` |
| **E-Commerce Intel** | `digital-shelf-metrics`, `category-rules` |

The `index.md` registry maps question types (e.g., `best_price`, `serp_sov`) to the exact skill pipeline needed.

## Performance

Optimized two-agent workflow targeting 7-9 WebOps turns + 3-4 DSA turns, ~$0.30 per question:

| Optimization | Impact |
|-------------|--------|
| Two-phase split (WebOps + DSA) | Focused prompts, fewer wasted turns |
| Tool-door isolation (separate MCP servers) | Prevents cross-phase tool misuse |
| Conditional decision tree (skip read_config/find_wsa_template) | ~10 fewer turns |
| Auto-validation in write_observation | 1 fewer turn per observation |
| Combined dedup_and_write_serp_candidates | 1 fewer turn |
| Batch agent loading (single DB query) | 3-10s faster startup |
| Circuit breaker (3 failures → skip) | Avoids hammering broken endpoints |
| Fire-and-forget ledger writes | Non-blocking observability |
| Step summaries with coverage tracking | Quantified data quality |

## License

Private — All rights reserved.
