-- ============================================================
-- Migration: 002_indexes_and_constraints.sql
-- Adds missing indexes and uniqueness constraints
-- ============================================================

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_observations_product_id
  ON observations (product_id);

CREATE INDEX IF NOT EXISTS idx_observations_validation_status
  ON observations (validation_status);

CREATE INDEX IF NOT EXISTS idx_observations_created_at
  ON observations (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_products_upc
  ON products (upc) WHERE upc IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_nimble_responses_request_id
  ON nimble_responses (nimble_request_id);

CREATE INDEX IF NOT EXISTS idx_run_steps_run_id
  ON run_steps (run_id);

-- Uniqueness constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_answers_run_id
  ON answers (run_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_observations_dedup
  ON observations (run_id, retailer_id, product_id, location_id)
  WHERE product_id IS NOT NULL;
