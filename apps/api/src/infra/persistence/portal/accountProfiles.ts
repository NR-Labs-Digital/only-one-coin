import { students } from "@ooc/db";
import { normalizeNationalId } from "@ooc/domain";
import { desc } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { reachesStudent } from "./reachableStudents.js";

/**
 * One person behind a portal account (OOC-147). An account reaches every
 * file `reachableStudentIdsSql` says it does: the student's own, the
 * guardian's children, and the not-yet-consolidated duplicates of either
 * (CLAUDE.md §1).
 * Duplicates are the same person, so files are grouped by the normalized
 * document — a guardian with two children sees two profiles, a student with
 * two copies of their file sees one.
 *
 * `id` is the group's newest file: the identity the portal shows, and the
 * owner a new upload hangs off.
 */
export interface AccountProfile {
  id: string;
  firstName: string;
  lastName: string;
  /** Every file of this person linked to the account, newest first. */
  fileIds: string[];
}

/** Newest person first, the same order the single-file portal read before. */
export async function profilesOfAccount(db: Pick<Db, "select">, userId: string): Promise<AccountProfile[]> {
  const rows = await db
    .select({
      id: students.id,
      firstName: students.firstName,
      lastName: students.lastName,
      nationalIdType: students.nationalIdType,
      nationalId: students.nationalId,
    })
    .from(students)
    .where(reachesStudent(userId))
    .orderBy(desc(students.createdAt), desc(students.id));

  const byPerson = new Map<string, AccountProfile>();
  for (const row of rows) {
    const key = `${row.nationalIdType}:${normalizeNationalId(row.nationalId)}`;
    const profile = byPerson.get(key);
    if (profile) profile.fileIds.push(row.id);
    else byPerson.set(key, { id: row.id, firstName: row.firstName, lastName: row.lastName, fileIds: [row.id] });
  }
  return [...byPerson.values()];
}

/**
 * The profile a request reads. The id comes from the client (a cookie), so it
 * only ever picks among the account's own profiles: an id that is not one of
 * them — someone else's file, a file unlinked since — falls back to the
 * default, the same answer as asking for nothing, and reveals nothing
 * (CLAUDE.md §8, anti-IDOR). Any file of the person selects it.
 */
export function pickProfile(profiles: AccountProfile[], requested: string | null): AccountProfile | null {
  if (requested) {
    const match = profiles.find((profile) => profile.fileIds.includes(requested));
    if (match) return match;
  }
  return profiles[0] ?? null;
}
