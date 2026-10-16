-- Refresh the planner's statistics (OOC-119). No schema or data change.
--
-- `deleted_at` reached most tables through `ADD COLUMN` (0012, 0025) after
-- their last ANALYZE. A column with no statistics gets Postgres' default
-- selectivity for `IS NULL` (0.5%), and `ADD COLUMN` rewrites no row, so
-- autovacuum never counted it as a change worth re-analyzing. In production
-- `enrollments` was estimated at 94 live rows out of 18,763: the student
-- directory joined 17k students to it with a nested loop — 149M comparisons,
-- 14 s per tab. ANALYZE runs inside the migration's transaction.
ANALYZE;
