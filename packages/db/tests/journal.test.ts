import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The migration journal, read as drizzle's migrator reads it. The migrator
 * applies a migration only when its `when` is later than the last one the
 * database recorded — so an entry whose `when` is not strictly after the one
 * before it is skipped, silently, on every database that already ran that
 * one: production says "migrations applied successfully" and the column never
 * appears. It happened once: 0053's `when` was written by hand ~8 h in the
 * future, and 0054, generated in between, sorted behind it.
 *
 * No database needed.
 */

interface Entry {
  idx: number;
  when: number;
  tag: string;
}

const dir = new URL("../migrations/", import.meta.url);
const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", dir), "utf8")) as { entries: Entry[] };

describe("migration journal", () => {
  it("keeps every `when` strictly after the one before it", () => {
    const outOfOrder = journal.entries
      .slice(1)
      .filter((entry, i) => entry.when <= journal.entries[i]!.when)
      .map((entry) => entry.tag);
    expect(outOfOrder).toEqual([]);
  });

  it("numbers the entries in order, one per SQL file", () => {
    expect(journal.entries.map((entry) => entry.idx)).toEqual(journal.entries.map((_, i) => i));
    const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
    expect(journal.entries.map((entry) => `${entry.tag}.sql`)).toEqual(files);
  });
});
