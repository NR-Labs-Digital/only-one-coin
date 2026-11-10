-- A proof sent from the e-mail screen (OOC-89): sample data to a staff
-- address. The e-mail figures and the undelivered list leave these rows out.
ALTER TABLE "outbox" ADD COLUMN "is_proof" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- The column enters WHERE, and ADD COLUMN gives it no statistics (packages/db/CLAUDE.md).
ANALYZE "outbox";
