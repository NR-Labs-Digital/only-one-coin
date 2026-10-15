-- Better Auth's `twoFactor` plugin (OOC-29): staff second factor by e-mail
-- code. Same shape the plugin's own schema declares
-- (better-auth/dist/plugins/two-factor/schema.mjs), written by hand like the
-- core tables in 0001 — Better Auth's tables are not in the Drizzle schema.
--
-- `"user"."twoFactorEnabled"` is what makes the plugin's sign-in hook withhold
-- the session until a code is verified. Nothing here turns it on for anyone:
-- the cargos that must have it (master, admin, billing — CLAUDE.md §8) are
-- refused by apps/api's authorization hook until they enroll, and enrolling
-- proves the e-mail with a code (apps/api/CLAUDE.md, "MFA do staff").
ALTER TABLE "user" ADD COLUMN "twoFactorEnabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- One row per account, written when the second factor is turned on: it holds
-- the recovery codes (encrypted) and the plugin's lockout counter. `secret`
-- is the plugin's TOTP column and is required by it; authenticator apps are
-- switched off (`totpOptions.disable`), so apps/api writes an encrypted
-- random value nobody ever reads back.
CREATE TABLE "twoFactor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backupCodes" text NOT NULL,
	"userId" text NOT NULL REFERENCES "user" ("id") ON DELETE cascade,
	"verified" boolean DEFAULT true NOT NULL,
	"failedVerificationCount" integer DEFAULT 0 NOT NULL,
	"lockedUntil" timestamp with time zone
);--> statement-breakpoint
CREATE UNIQUE INDEX "twoFactor_userId_uidx" ON "twoFactor" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "twoFactor_secret_idx" ON "twoFactor" USING btree ("secret");
