import { Language, LanguageExistsError, languageKey, type ILanguageRepository } from "@ooc/domain";
import { courses, languages, teacherLanguages } from "@ooc/db";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { isUniqueViolation } from "@/infra/db/isUniqueViolation.js";

/** One live language per key (migration 0042) — the net under the usecase. */
export const LANGUAGE_KEY_INDEX = "languages_key_live_uidx";

function keyRace(error: unknown): never {
  if (isUniqueViolation(error, LANGUAGE_KEY_INDEX)) throw new LanguageExistsError({ cause: error });
  throw error;
}

function languageFromRow(row: typeof languages.$inferSelect): Language {
  return new Language({
    id: row.id,
    name: row.name,
    key: row.key,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });
}

export class DrizzleLanguageRepository implements ILanguageRepository {
  constructor(private readonly db: Db) {}

  async create(language: Language): Promise<void> {
    await this.db
      .insert(languages)
      .values({ id: language.id, name: language.name, key: language.key })
      .catch(keyRace);
  }

  async findById(id: string): Promise<Language | null> {
    const [row] = await this.db.select().from(languages).where(eq(languages.id, id)).limit(1);
    return row ? languageFromRow(row) : null;
  }

  async rename(language: Language): Promise<void> {
    await this.db
      .transaction(async (tx) => {
        await tx
          .update(languages)
          .set({ name: language.name, key: language.key, updatedAt: sql`now()` })
          .where(eq(languages.id, language.id));
        // The text copies follow the record until the screens read the id
        // (expand/contract, CLAUDE.md §7) — retired courses too, so the
        // enrollment ledger keeps one spelling.
        await tx
          .update(courses)
          .set({ language: language.name, updatedAt: sql`now()` })
          .where(eq(courses.languageId, language.id));
        await tx
          .update(teacherLanguages)
          .set({ language: language.name, updatedAt: sql`now()` })
          .where(eq(teacherLanguages.languageId, language.id));
      })
      .catch(keyRace);
  }

  async countLiveCourses(id: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(courses)
      .where(and(eq(courses.languageId, id), isNull(courses.deletedAt)));
    return row?.total ?? 0;
  }

  async retire(language: Language): Promise<number> {
    return this.db.transaction(async (tx) => {
      await tx
        .update(languages)
        .set({ deletedAt: language.deletedAt, updatedAt: sql`now()` })
        .where(eq(languages.id, language.id));
      const released = await tx
        .delete(teacherLanguages)
        .where(eq(teacherLanguages.languageId, language.id))
        .returning({ id: teacherLanguages.id });
      return released.length;
    });
  }
}

/**
 * The live language a name stands for, opened when there is none — for the
 * scripts that write courses straight to the database (seed, legacy import),
 * so a course they write is filed under the list like one opened on screen.
 * Answers the record's own name: that is the spelling the course carries.
 */
export async function languageFor(db: Db, name: string): Promise<{ id: string; name: string }> {
  const key = languageKey(name);
  const [live] = await db
    .select({ id: languages.id, name: languages.name })
    .from(languages)
    .where(and(eq(languages.key, key), isNull(languages.deletedAt)))
    .limit(1);
  if (live) return live;
  const opened = Language.create(name);
  await db.insert(languages).values({ id: opened.id, name: opened.name, key: opened.key });
  return { id: opened.id, name: opened.name };
}
