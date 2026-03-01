-- ============================================================
-- Agent DSA - Complete Database Schema
-- Migration: 001_schema.sql
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE product_category AS ENUM (
  'cereal', 'snacks', 'baking', 'yogurt', 'meals', 'pet', 'other'
);

CREATE TYPE run_status AS ENUM (
  'pending', 'running', 'completed', 'completed_with_errors',
  'partial_success', 'failed', 'cancelled'
);

CREATE TYPE collection_method AS ENUM ('website_search_agent', 'nimble_web_tools');

CREATE TYPE collection_tier AS ENUM ('wsa', 'search_extract', 'generic_llm');

CREATE TYPE match_method AS ENUM ('upc', 'exact_title', 'fuzzy', 'manual');

CREATE TYPE schedule_frequency AS ENUM ('hourly', 'daily', 'weekly', 'custom');

CREATE TYPE location_source AS ENUM ('discovered', 'manual');

CREATE TYPE agent_entity_type AS ENUM ('serp', 'pdp', 'clp');

CREATE TYPE validation_status AS ENUM ('pass', 'warn', 'fail');

CREATE TYPE run_step_type AS ENUM ('serp', 'pdp', 'category', 'validation', 'aggregation');

CREATE TYPE nimble_step AS ENUM ('serp', 'pdp', 'fallback');

CREATE TYPE retry_outcome AS ENUM ('success', 'fail', 'timeout');

CREATE TYPE question_type AS ENUM (
  'best_price', 'price_trend', 'oos_monitor',
  'serp_sov', 'assortment_coverage', 'promotion_scan'
);

CREATE TYPE answer_status AS ENUM ('pending', 'ready', 'error');

-- ============================================================
-- TABLES (22)
-- ============================================================

-- 1. locations
CREATE TABLE locations (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  city        text NOT NULL,
  state       text NOT NULL,
  country     text DEFAULT 'US',
  zip_codes   jsonb NOT NULL DEFAULT '[]',
  timezone    text NOT NULL,
  is_active   boolean DEFAULT true,
  source      location_source DEFAULT 'manual',
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 2. nimble_agents
CREATE TABLE nimble_agents (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id   int UNIQUE NOT NULL,
  name          text NOT NULL,
  domain        text,
  entity_type   agent_entity_type NOT NULL,
  capabilities  jsonb DEFAULT '{}',
  last_seen_at  timestamptz,
  is_healthy    boolean DEFAULT true,
  status_note   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- 3. retailers
CREATE TABLE retailers (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name               text NOT NULL,
  domain             text NOT NULL,
  serp_agent_id      uuid REFERENCES nimble_agents(id),
  pdp_agent_id       uuid REFERENCES nimble_agents(id),
  supports_location  boolean DEFAULT false,
  is_active          boolean DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- 4. products
CREATE TABLE products (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           text NOT NULL,
  brand          text NOT NULL,
  category       product_category,
  is_competitor  boolean DEFAULT false,
  upc            text,
  synonyms       text[] DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- 5. product_matches
CREATE TABLE product_matches (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  retailer_id      uuid NOT NULL REFERENCES retailers(id),
  retailer_sku     text NOT NULL,
  retailer_url     text,
  product_id       uuid REFERENCES products(id),
  confidence       float,
  match_method     match_method,
  manual_override  boolean DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (retailer_id, retailer_sku)
);

-- 6. question_templates
CREATE TABLE question_templates (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  type                question_type NOT NULL,
  name                text NOT NULL,
  prompt_template     text NOT NULL,
  description         text,
  default_parameters  jsonb DEFAULT '{}',
  is_active           boolean DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- 7. keyword_sets
CREATE TABLE keyword_sets (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          text NOT NULL,
  description   text,
  version       int NOT NULL DEFAULT 1,
  category_tag  text,
  is_default    boolean DEFAULT false,
  parent_id     uuid REFERENCES keyword_sets(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 8. keyword_set_items
CREATE TABLE keyword_set_items (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  keyword_set_id  uuid NOT NULL REFERENCES keyword_sets(id),
  keyword         text NOT NULL,
  retailer_scope  text,
  category_tag    text,
  expected_brand  text,
  priority        int DEFAULT 0
);

-- 9. runs
CREATE TABLE runs (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id           uuid REFERENCES locations(id),
  retailer_ids          uuid[] DEFAULT '{}',
  keyword_set_id        uuid REFERENCES keyword_sets(id),
  keyword_set_version   int,
  categories            text[],
  parameters            jsonb DEFAULT '{}',
  question_text         text,
  question_template_id  uuid REFERENCES question_templates(id),
  agent_session_id      text,
  status                run_status DEFAULT 'pending',
  started_at            timestamptz,
  finished_at           timestamptz,
  summary               text,
  total_cost_usd        numeric,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- 10. answers
CREATE TABLE answers (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id                uuid NOT NULL REFERENCES runs(id),
  question_template_id  uuid REFERENCES question_templates(id),
  question_text         text NOT NULL,
  answer_text           text NOT NULL,
  answer_data           jsonb,
  status                answer_status DEFAULT 'pending',
  confidence            float,
  sources_count         int DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- 11. serp_candidates
CREATE TABLE serp_candidates (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id               uuid NOT NULL REFERENCES runs(id),
  keyword_set_item_id  uuid REFERENCES keyword_set_items(id),
  retailer_id          uuid NOT NULL REFERENCES retailers(id),
  rank                 int,
  title                text,
  is_sponsored         boolean DEFAULT false,
  snippet_price        numeric,
  badge                text,
  pdp_url              text,
  retailer_product_id  text,
  raw_payload          jsonb,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- 12. run_steps
CREATE TABLE run_steps (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id          uuid NOT NULL REFERENCES runs(id),
  step_type       run_step_type NOT NULL,
  retailer_id     uuid REFERENCES retailers(id),
  status          text DEFAULT 'pending',
  started_at      timestamptz,
  finished_at     timestamptz,
  request_count   int DEFAULT 0,
  success_count   int DEFAULT 0,
  failure_count   int DEFAULT 0,
  summary         jsonb
);

-- 13. observations (generalized from price_observations)
CREATE TABLE observations (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id              uuid NOT NULL REFERENCES runs(id),
  retailer_id         uuid NOT NULL REFERENCES retailers(id),
  location_id         uuid NOT NULL REFERENCES locations(id),
  product_id          uuid REFERENCES products(id),
  product_match_id    uuid REFERENCES product_matches(id),
  shelf_price         numeric,
  promo_price         numeric,
  unit_price          numeric,
  size_oz             numeric,
  size_raw            text,
  pack_count          int DEFAULT 1,
  in_stock            boolean,
  rating              numeric,
  review_count        int,
  serp_rank           int,
  confidence          float,
  raw_payload         jsonb,
  source_url          text,
  collection_method   collection_method,
  collection_tier     collection_tier,
  zip_used            text,
  validation_status   validation_status,
  validation_reasons  text[] DEFAULT '{}',
  quality_score       float,
  ai_parsed_fields    jsonb,
  ai_confidence       float,
  is_published        boolean DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- 14. nimble_requests
CREATE TABLE nimble_requests (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id              uuid REFERENCES runs(id),
  run_step_id         uuid REFERENCES run_steps(id),
  retailer_id         uuid REFERENCES retailers(id),
  agent_template_id   int,
  collection_tier     collection_tier,
  request_payload     jsonb,
  keyword             text,
  location_context    jsonb,
  attempt_number      int DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- 15. nimble_responses
CREATE TABLE nimble_responses (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  nimble_request_id   uuid NOT NULL REFERENCES nimble_requests(id),
  raw_payload         jsonb,
  payload_ref         text,
  payload_sha256      text,
  payload_size_bytes  int,
  parsing_summary     jsonb,
  http_status         int,
  response_size_bytes int,
  latency_ms          int,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- 16. validation_results
CREATE TABLE validation_results (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id            uuid REFERENCES runs(id),
  observation_id    uuid REFERENCES observations(id),
  status            validation_status NOT NULL,
  reasons           text[] DEFAULT '{}',
  quality_score     float,
  validator_version text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- 17. audit_events
CREATE TABLE audit_events (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_action   text NOT NULL,
  entity_type   text,
  entity_id     uuid,
  before_state  jsonb,
  after_state   jsonb,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 18. subscriptions
CREATE TABLE subscriptions (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  text NOT NULL,
  location_id           uuid REFERENCES locations(id),
  retailer_ids          uuid[] DEFAULT '{}',
  keyword_set_id        uuid REFERENCES keyword_sets(id),
  question_template_id  uuid REFERENCES question_templates(id),
  categories            text[],
  frequency             schedule_frequency NOT NULL DEFAULT 'daily',
  interval_hours        int,
  schedule_time         time,
  days_of_week          int[],
  timezone              text,
  next_run_at           timestamptz,
  last_run_at           timestamptz,
  is_active             boolean DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- 19. run_errors
CREATE TABLE run_errors (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id          uuid NOT NULL REFERENCES runs(id),
  retailer_id     uuid REFERENCES retailers(id),
  step            nimble_step,
  keyword         text,
  input_params    jsonb,
  error_code      text,
  error_message   text,
  error_type      text,
  attempt_count   int DEFAULT 0,
  last_attempt_at timestamptz,
  retry_count     int DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 20. fallback_events
CREATE TABLE fallback_events (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id           uuid NOT NULL REFERENCES runs(id),
  retailer_id      uuid REFERENCES retailers(id),
  keyword          text,
  from_tier        collection_tier,
  to_tier          collection_tier,
  trigger_reason   text,
  trigger_details  jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- 21. agent_health_daily
CREATE TABLE agent_health_daily (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  date                 date NOT NULL,
  retailer_id          uuid REFERENCES retailers(id),
  agent_template_id    int,
  total_calls          int DEFAULT 0,
  successful_calls     int DEFAULT 0,
  failed_calls         int DEFAULT 0,
  success_rate         float,
  pct_wsa              float,
  pct_fallback         float,
  last_failure_reason  text,
  first_failure_at     timestamptz,
  UNIQUE (date, agent_template_id)
);

-- 22. agent_logs
CREATE TABLE agent_logs (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id        uuid NOT NULL REFERENCES runs(id),
  session_id    text,
  tool_name     text,
  tool_input    jsonb,
  tool_output   jsonb,
  reasoning     text,
  token_usage   jsonb,
  cost_usd      numeric,
  duration_ms   int,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_observations_run_id
  ON observations (run_id);

CREATE INDEX idx_observations_retailer_location_created
  ON observations (retailer_id, location_id, created_at DESC);

CREATE INDEX idx_serp_candidates_run_retailer
  ON serp_candidates (run_id, retailer_id);

CREATE INDEX idx_product_matches_retailer_sku
  ON product_matches (retailer_id, retailer_sku);

CREATE INDEX idx_runs_status
  ON runs (status);

CREATE INDEX idx_runs_location_id
  ON runs (location_id);

CREATE INDEX idx_nimble_agents_domain
  ON nimble_agents (domain);

CREATE INDEX idx_nimble_agents_template_id
  ON nimble_agents (template_id);

CREATE INDEX idx_keyword_set_items_keyword_set_id
  ON keyword_set_items (keyword_set_id);

CREATE INDEX idx_agent_logs_run_id
  ON agent_logs (run_id);

CREATE INDEX idx_answers_run_id
  ON answers (run_id);

CREATE INDEX idx_nimble_requests_run_id
  ON nimble_requests (run_id);
