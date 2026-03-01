# Agent DSA

AI-powered e-commerce intelligence platform that collects product data (prices, availability, ratings, promotions) from major retailers and answers competitive positioning questions. Built for General Mills using Claude AI agents and Nimble web scraping.

## How It Works

A natural language question like _"Best price for Cheerios across Amazon and Walmart in Chicago"_ triggers a Claude AI agent that follows an optimized decision tree:

**Fast Path** (retailer + product known — 4 steps, ~7-9 agent turns):
1. `serp_search` — find matching products on the retailer SERP
2. `pdp_fetch` — get structured pricing from product detail pages
3. `write_observation` — auto-validates and persists in one call
4. `write_answer` — returns a confidence-scored answer with source URLs

**Discovery Path** (ambiguous query): reads config first, then follows the fast path.
**Fallback Path** (WSA agent unavailable): uses `web_search_fallback` + `url_extract_fallback`.

All API calls, tool invocations, and validation decisions are logged to Supabase for full observability.

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│   CLI / Web  │────>│   Claude Agent    │────>│  Nimble WSA  │
│  (question)  │     │  (Agent SDK)      │     │  (scraping)  │
└─────────────┘     └──────────────────┘     └──────────────┘
                           │                         │
                           v                         v
                    ┌──────────────┐         ┌──────────────┐
                    │   Supabase   │<────────│  Parsed Data │
                    │  (Postgres)  │         │  + Validation│
                    └──────────────┘         └──────────────┘
```

**Monorepo layout:**

```
agent-dsa/
├── agent/       # Agent executor — tools, prompts, Nimble client
├── shared/      # Shared TypeScript types
├── web/         # Web frontend (Next.js)
└── supabase/    # Database migrations and seed data
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
AGENT_MAX_TURNS=30
AGENT_POLL_INTERVAL_MS=5000
```

### Database Setup

```bash
npm run db:push    # Apply migrations (22 tables)
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

The Claude agent has access to 13 specialized tools organized by tier:

### Data Collection (Tier 1 — WSA)
| Tool | Description |
|------|-------------|
| `serp_search` | Search retailer product listings via Nimble WSA agents |
| `pdp_fetch` | Fetch structured product detail page (price, stock, ratings) |

### Data Collection (Tier 2 — Fallback)
| Tool | Description |
|------|-------------|
| `web_search_fallback` | General web search when WSA is unavailable |
| `url_extract_fallback` | Extract content from arbitrary URLs |

### Metadata
| Tool | Description |
|------|-------------|
| `find_wsa_template` | Discover available Nimble WSA agents for a retailer |
| `read_config` | Query config tables (locations, retailers, products) |

### Data Write
| Tool | Description |
|------|-------------|
| `write_observation` | Auto-validates and stores a price/availability data point |
| `write_serp_candidates` | Store ranked search result listings |
| `dedup_and_write_serp_candidates` | Deduplicate and persist SERP results in one call |
| `write_answer` | Store the final computed answer |

### Quality
| Tool | Description |
|------|-------------|
| `validate_observation` | Optional pre-check (write_observation auto-validates) |
| `dedup_candidates` | Remove duplicate SERP results (standalone) |

## Data Validation

Every observation is **auto-validated** inside `write_observation` with category-specific checks:

- Price is positive and within bounds (e.g., cereal: $0.50 - $30)
- Promo price < shelf price
- Size parses correctly (supports oz, lb, g, kg, multi-packs)
- Unit price is consistent (price / size within 10%)
- Source URL domain matches retailer
- Rating within 0-5 range
- Confidence within 0-1 range

Each check produces a quality score (0.3 fail / 0.7 warn / 1.0 pass). Validation results are returned inline with the write response — no separate `validate_observation` call needed.

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

22 tables organized into:

- **Config** — `locations`, `retailers`, `nimble_agents`, `products`, `product_matches`
- **Workflow** — `question_templates`, `keyword_sets`, `runs`, `answers` (unique per run)
- **Data** — `serp_candidates`, `observations` (deduplicated per run+retailer+product+location), `run_steps`
- **API Tracking** — `nimble_requests`, `nimble_responses`, `fallback_events`
- **Quality** — `validation_results`, `agent_logs`, `run_errors`, `agent_health_daily`
- **Admin** — `subscriptions`, `audit_events`

Key indexes: `observations(product_id)`, `observations(validation_status)`, `observations(created_at DESC)`, `products(upc)`, `nimble_responses(nimble_request_id)`, `run_steps(run_id)`.

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

## Performance

Optimized agent workflow targeting 7-9 turns and ~$0.30 per question (down from 22 turns / $0.88 baseline):

| Optimization | Impact |
|-------------|--------|
| Conditional decision tree (skip read_config/find_wsa_template) | ~10 fewer turns |
| Auto-validation in write_observation | 1 fewer turn per observation |
| Combined dedup_and_write_serp_candidates | 1 fewer turn |
| Batch agent loading (single DB query) | 3-10s faster startup |
| Reduced retry delays for fallback tools | 2-4s faster on retries |
| Fire-and-forget logging | Non-blocking tool calls |
| Turn-by-turn CLI progress (`[turn N] tool_name...`) | Debugging visibility |

## License

Private — All rights reserved.
