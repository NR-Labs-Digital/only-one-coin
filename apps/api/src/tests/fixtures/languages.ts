import { languages } from "@ooc/db";
import { languageKey } from "@ooc/domain";
import type { Db } from "@/infra/db/client.js";

/**
 * Puts the given languages on the list (OOC-128): a teacher is only cleared
 * for a language that is on it, so a suite that saves teachers files theirs
 * first. Meant for a transaction the suite rolls back.
 */
export async function seedLanguages(tx: Pick<Db, "insert">, names: string[]): Promise<void> {
  await tx.insert(languages).values(names.map((name) => ({ name, key: languageKey(name) })));
}
