import { createRequire } from "node:module";

interface Journal {
  entries: { when: number; tag: string }[];
}

/**
 * The `when` of every migration in the repository, in order — what drizzle
 * stores as `created_at` in `drizzle.__drizzle_migrations`. The restore checks
 * compare a backup's migrations against it (OOC-153). Read from
 * `@ooc/db/migrations-journal`, which ships inside the API image.
 */
export function repositoryMigrationStamps(): number[] {
  const require = createRequire(import.meta.url);
  const journal = require("@ooc/db/migrations-journal") as Journal;
  return journal.entries.map((entry) => entry.when);
}
