-- Puts CLAUDE.md §6 ("Delete físico — sem grant de DELETE em student, payment,
-- audit. Só deleted_at") and §8 ("audit_log append-only: sem grant de UPDATE
-- nem DELETE, nem para admin") into the database itself.
--
-- Until this migration both rules were kept by the domain layer alone, and an
-- interface can only refuse what goes through it: anyone reaching Postgres with
-- a connection string — a leaked credential, a psql session, a query console —
-- was refused by nothing and could delete a student or rewrite the audit trail.
--
-- Two layers, because they stop different people:
--
--   1. GRANT — `ooc_app`, the role apps/api connects as, simply has no DELETE
--      on the locked tables and no UPDATE on audit_log. Least privilege, and
--      the mechanism §6 names. It does not bind whoever owns the tables.
--   2. TRIGGER — statement-level triggers that raise on DELETE/TRUNCATE (and
--      UPDATE, on audit_log). These fire for everyone, the table owner and a
--      superuser included, which is what the GRANT layer cannot do and what
--      the realistic leak needs: today DATABASE_URL still carries the owner.
--
-- Deliberately no escape hatch. Undoing the lock for a legitimate purge (a Ley
-- 29733 erasure that soft delete cannot answer) means a new migration dropping
-- the trigger — reviewed, versioned, auditable. A session flag the trigger
-- honoured would hand the same key to whoever the trigger exists to stop.
--
-- Not expressible in src/schema.ts (Drizzle Kit's declarative diff has no role,
-- grant or trigger primitive), so it is hand-written — same precedent as
-- 0001_better_auth_core.sql and 0002_enable_pg_trgm.sql.

-- ---------------------------------------------------------------------------
-- 1. The application role
-- ---------------------------------------------------------------------------
-- NOLOGIN on purpose: a password is a credential and never lives in a
-- versioned migration (CLAUDE.md §6, ".env no Git"). Each environment turns
-- the role on once, out of band, with a secret of its own:
--
--     ALTER ROLE ooc_app WITH LOGIN PASSWORD '<secret>';
--
-- and DATABASE_URL for apps/api (Fly.io secret) then points at ooc_app instead
-- of the owner. Until that happens the GRANT layer below is inert and only the
-- TRIGGER layer is holding — which is why the trigger layer exists.
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ooc_app') THEN
		CREATE ROLE ooc_app NOLOGIN;
	END IF;
END
$$;
--> statement-breakpoint

COMMENT ON ROLE ooc_app IS 'Least-privilege role apps/api connects as. Owns nothing; cannot DELETE from students/payments/payment_receipts/consents/audit_log, cannot UPDATE audit_log (migration 0011).';
--> statement-breakpoint

-- Lets whoever runs migrations SET ROLE ooc_app — how the privilege suite
-- (packages/db/tests/privileges.test.ts) checks the GRANT layer without
-- needing the role's password. Membership grants no privilege the migration
-- runner does not already have: ooc_app's rights are a strict subset.
GRANT ooc_app TO CURRENT_USER;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. GRANT layer — everything, then take the four statements away
-- ---------------------------------------------------------------------------
-- Granted broadly and revoked surgically rather than listed table by table: a
-- new table must not silently arrive unreachable to the API, and the lock is
-- the exception, so the exception is what gets spelled out.
GRANT USAGE ON SCHEMA public TO ooc_app;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ooc_app;
--> statement-breakpoint

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ooc_app;
--> statement-breakpoint

-- Same reach for tables created by later migrations, so nobody has to remember.
-- TRUNCATE is absent from both grants above and here, for every table: it
-- deletes rows without firing a row trigger and resets nothing the platform
-- needs at runtime.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ooc_app;
--> statement-breakpoint

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ooc_app;
--> statement-breakpoint

-- students: replaced by deleted_at. payments and payment_receipts: the money
-- and the proof of it, kept 5 years (CLAUDE.md §1). consents: the Ley 29733
-- record, append-only — each acceptance is a row, with version, date and IP.
-- audit_log: append-only, and the one table that must survive the account that
-- wrote in it.
REVOKE DELETE ON students, payments, payment_receipts, consents, audit_log FROM ooc_app;
--> statement-breakpoint

REVOKE UPDATE ON audit_log FROM ooc_app;
--> statement-breakpoint

-- A future table created by a later migration inherits DELETE from the default
-- privileges above. Adding it to the lock is a new migration with its own
-- REVOKE plus its own trigger — both, never one of the two.

-- ---------------------------------------------------------------------------
-- 3. TRIGGER layer — binds the owner too
-- ---------------------------------------------------------------------------
-- FOR EACH STATEMENT, not FOR EACH ROW: it fires even when the statement
-- matches no row (so `DELETE FROM students WHERE <no match>` is refused rather
-- than quietly doing nothing, and the refusal is testable without fixtures),
-- it costs one call instead of one per row, and it is the only shape that can
-- carry TRUNCATE — which bypasses row triggers entirely and is how one would
-- empty audit_log in a single statement.
--
-- SQLSTATE OOC01 is ours: it tells the privilege suite (and any future error
-- mapping in apps/api) that this was the platform refusing on purpose, not
-- Postgres running out of permission (42501) or a constraint tripping.
CREATE OR REPLACE FUNCTION forbid_history_rewrite() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION '% on % is not allowed: this table is append-only', TG_OP, TG_TABLE_NAME
		USING ERRCODE = 'OOC01',
		      HINT = 'Use deleted_at where the table has one. Lifting this lock takes a migration dropping the trigger.';
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS students_no_physical_delete ON students;
--> statement-breakpoint
CREATE TRIGGER students_no_physical_delete
	BEFORE DELETE OR TRUNCATE ON students
	FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_rewrite();
--> statement-breakpoint

DROP TRIGGER IF EXISTS payments_no_physical_delete ON payments;
--> statement-breakpoint
CREATE TRIGGER payments_no_physical_delete
	BEFORE DELETE OR TRUNCATE ON payments
	FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_rewrite();
--> statement-breakpoint

DROP TRIGGER IF EXISTS payment_receipts_no_physical_delete ON payment_receipts;
--> statement-breakpoint
CREATE TRIGGER payment_receipts_no_physical_delete
	BEFORE DELETE OR TRUNCATE ON payment_receipts
	FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_rewrite();
--> statement-breakpoint

DROP TRIGGER IF EXISTS consents_no_physical_delete ON consents;
--> statement-breakpoint
CREATE TRIGGER consents_no_physical_delete
	BEFORE DELETE OR TRUNCATE ON consents
	FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_rewrite();
--> statement-breakpoint

-- audit_log is the only one that also refuses UPDATE: everywhere else a row
-- still changes over its life (a payment moves through its states, a student
-- corrects an address). Here nothing ever does — an audit entry that can be
-- edited is not an audit entry.
DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only
	BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_log
	FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_rewrite();
