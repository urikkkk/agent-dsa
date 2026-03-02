-- Allow observations without a specific location (e.g., national online pricing).
-- The FK constraint is kept; only the NOT NULL requirement is dropped.
ALTER TABLE observations ALTER COLUMN location_id DROP NOT NULL;
