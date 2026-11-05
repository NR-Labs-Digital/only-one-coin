-- Retiring a panel account (OOC-136): the row stays, because payments, contracts
-- and the audit trail keep pointing at it, and it leaves the team directory.
-- camelCase like every other column of Better Auth's "user" table (0001, 0007,
-- 0029). The table is not in the Drizzle schema, so this is written by hand.
ALTER TABLE "user" ADD COLUMN "deletedAt" timestamp with time zone;--> statement-breakpoint
-- The column enters WHERE, and ADD COLUMN gives it no statistics (packages/db/CLAUDE.md).
ANALYZE "user";
