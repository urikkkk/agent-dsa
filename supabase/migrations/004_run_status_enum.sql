-- ============================================================
-- 004: Add collecting/analyzing to run_status enum
-- The orchestrator writes these statuses but they were missing
-- from the original enum definition, causing silent write failures.
-- ============================================================

ALTER TYPE run_status ADD VALUE IF NOT EXISTS 'collecting' AFTER 'pending';
ALTER TYPE run_status ADD VALUE IF NOT EXISTS 'analyzing' AFTER 'collecting';
