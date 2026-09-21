import { describe, expect, it } from "vitest";
import { DEFAULT_COUNT, buildPeople } from "@/scripts/seed-students/people.js";

/**
 * The seeded directory only helps if it behaves like a real one. Two of these
 * are not cosmetic:
 *
 * - Documents must be unique, because one document is one person now
 *   (CLAUDE.md §1) — a seed that contradicts the rule it is meant to exercise
 *   is worse than no seed.
 * - The generator must be deterministic, because a rerun looks up what is
 *   already on file by document. Randomise it and the second run silently
 *   doubles the directory.
 */

const NOW = new Date("2026-09-21T12:00:00.000Z");

describe("seed-students generator", () => {
  it("invents the asked-for number of people", () => {
    expect(buildPeople(DEFAULT_COUNT, NOW)).toHaveLength(300);
  });

  it("gives every person their own document and e-mail", () => {
    const people = buildPeople(DEFAULT_COUNT, NOW);

    expect(new Set(people.map((person) => person.nationalId)).size).toBe(people.length);
    expect(new Set(people.map((person) => person.email)).size).toBe(people.length);
  });

  it("produces the same people on a rerun", () => {
    expect(buildPeople(50, NOW)).toEqual(buildPeople(50, NOW));
  });

  it("never leaves a minor without a guardian", () => {
    const people = buildPeople(DEFAULT_COUNT, NOW);

    const ageOf = (birthDate: Date) => {
      let age = NOW.getUTCFullYear() - birthDate.getUTCFullYear();
      const hadBirthday =
        NOW.getUTCMonth() > birthDate.getUTCMonth() ||
        (NOW.getUTCMonth() === birthDate.getUTCMonth() && NOW.getUTCDate() >= birthDate.getUTCDate());
      if (!hadBirthday) age -= 1;
      return age;
    };

    const minors = people.filter((person) => ageOf(person.birthDate) < 18);

    // Enough of them to make the "only minors" filter worth clicking.
    expect(minors.length).toBeGreaterThan(30);
    expect(minors.every((person) => person.guardian !== null)).toBe(true);
  });

  it("gives the student a Gmail address", () => {
    // Not decoration: access to the class arrives through Google Classroom, so
    // the platform refuses anything else for a student (CLAUDE.md §1).
    const people = buildPeople(DEFAULT_COUNT, NOW);
    expect(people.every((person) => person.email.endsWith("@gmail.com"))).toBe(true);
  });

  it("collides some timestamps on purpose, for the cursor to trip over", () => {
    // `(created_at, id)` is the directory's cursor. Rows sharing a timestamp
    // are what makes the tie-break necessary, and a seed where every row has
    // its own millisecond would never exercise it.
    const people = buildPeople(DEFAULT_COUNT, NOW);
    const timestamps = people.map((person) => person.createdAt.getTime());

    expect(new Set(timestamps).size).toBeLessThan(people.length);
  });
});
