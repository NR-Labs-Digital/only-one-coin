import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // No `env` block on purpose: unlike apps/api, this suite needs a real,
    // migrated Postgres, and DATABASE_URL has to point at whichever one the
    // caller means (compose locally, the service container in CI). A default
    // baked in here would be a `localhost` hardcoded in code (CLAUDE.md §6)
    // and, worse, would let the suite quietly run against the wrong database.
    //
    // One connection, one transaction at a time: the suite sets roles and
    // rolls back on a single session, so parallel files would step on it.
    fileParallelism: false,
  },
});
