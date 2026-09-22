import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The suites that need a real, migrated Postgres — kept apart from
 * `vitest.config.ts` so the default `pnpm test` stays a pure-domain run that
 * needs no database, and so CI can put these where a database already exists
 * (the `migrations` job).
 *
 * No `env` block: DATABASE_URL has to come from the caller, pointing at
 * whichever database they mean. A default baked in here would be a localhost
 * hardcoded in code (CLAUDE.md §6) and, worse, would let the suite quietly run
 * against the wrong database.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
    conditions: ["development"],
  },
  test: {
    include: ["src/**/*.integration.test.ts"],
    // One database, one transaction at a time.
    fileParallelism: false,
  },
});
