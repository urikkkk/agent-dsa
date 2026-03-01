-- ============================================================
-- 003: Observability & Ledger System
-- Adds structured event tracking, artifact storage, and step summaries
-- ============================================================

-- --- Enums ---

CREATE TYPE ledger_event_status AS ENUM ('started', 'completed', 'failed', 'skipped', 'retrying');
CREATE TYPE ledger_event_type AS ENUM ('task', 'step', 'tool_door_violation', 'watchdog_timeout');

-- --- Tables ---

-- Append-only event log for all agent activity
CREATE TABLE ledger_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL REFERENCES runs(id),
  event_type      ledger_event_type NOT NULL DEFAULT 'task',
  agent_name      text NOT NULL,
  step_name       text NOT NULL,
  task_id         text NOT NULL,
  attempt         int NOT NULL DEFAULT 1,
  status          ledger_event_status NOT NULL,
  span_id         uuid DEFAULT gen_random_uuid(),
  parent_span_id  uuid,
  tool_name       text,
  input_ref       uuid,
  output_ref      uuid,
  error           jsonb,
  metrics         jsonb,
  provenance      jsonb,
  next_action_hint text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Raw I/O artifact storage with hash-based deduplication
CREATE TABLE ledger_artifacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL REFERENCES runs(id),
  content_type    text NOT NULL DEFAULT 'application/json',
  payload         jsonb,
  storage_ref     text,
  size_bytes      int,
  sha256          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- --- Alter run_steps for step summaries ---

ALTER TABLE run_steps ADD COLUMN agent_name text;
ALTER TABLE run_steps ADD COLUMN coverage_pct numeric;
ALTER TABLE run_steps ADD COLUMN fallback_rate numeric;
ALTER TABLE run_steps ADD COLUMN error_clusters jsonb;
ALTER TABLE run_steps ADD COLUMN rerun_plan jsonb;

-- --- Indexes ---

-- Artifact deduplication (hash-first reuse)
CREATE UNIQUE INDEX idx_ledger_artifacts_sha256
  ON ledger_artifacts (sha256)
  WHERE sha256 IS NOT NULL;

-- Event queries
CREATE INDEX idx_ledger_events_run_id ON ledger_events (run_id, created_at);
CREATE INDEX idx_ledger_events_task_id ON ledger_events (task_id, attempt);
CREATE INDEX idx_ledger_events_run_status ON ledger_events (run_id, status);
CREATE INDEX idx_ledger_events_event_type ON ledger_events (run_id, event_type) WHERE event_type != 'task';
CREATE INDEX idx_ledger_events_span ON ledger_events (parent_span_id) WHERE parent_span_id IS NOT NULL;

-- Artifact queries
CREATE INDEX idx_ledger_artifacts_run_id ON ledger_artifacts (run_id);

-- Step queries
CREATE INDEX idx_run_steps_agent ON run_steps (run_id, agent_name);

-- --- Backward-compatible view ---

CREATE OR REPLACE VIEW agent_logs_v2 AS
  SELECT
    e.id,
    e.run_id,
    e.agent_name AS session_id,
    e.tool_name,
    (SELECT a.payload FROM ledger_artifacts a WHERE a.id = e.input_ref) AS tool_input,
    (SELECT a.payload FROM ledger_artifacts a WHERE a.id = e.output_ref) AS tool_output,
    NULL::text AS reasoning,
    (e.metrics->>'tokens')::jsonb AS token_usage,
    (e.metrics->>'cost_usd')::numeric AS cost_usd,
    (e.metrics->>'latency_ms')::int AS duration_ms,
    e.created_at
  FROM ledger_events e;
