-- The language an account chose on its own profile (OOC-150): the student's
-- Perfil, the panel's and the docente's Cuenta. Null until the person picks
-- one — the app then speaks whatever the route says, es-PE by default.
-- camelCase like every other column of Better Auth's "user" table (0001, 0029,
-- 0047). The table is not in the Drizzle schema, so this is written by hand.
-- Read only by the account's own id, never in WHERE: no ANALYZE.
ALTER TABLE "user" ADD COLUMN "preferredLocale" text;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_preferred_locale_check" CHECK ("preferredLocale" in ('es-PE', 'pt-BR', 'en'));
