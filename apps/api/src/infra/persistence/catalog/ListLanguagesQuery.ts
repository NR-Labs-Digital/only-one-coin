import { courses, languages, teacherLanguages, teachers } from "@ooc/db";
import { asc, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

export interface LanguageListItem {
  id: string;
  name: string;
  /** Live courses filed under it — a language with any cannot be retired. */
  courseCount: number;
  /** Live teachers cleared for it. */
  teacherCount: number;
}

/** The live languages, by name, with what hangs on each (OOC-128). */
export class ListLanguagesQuery {
  constructor(private readonly db: Db) {}

  async run(): Promise<LanguageListItem[]> {
    return this.db
      .select({
        id: languages.id,
        name: languages.name,
        courseCount: sql<number>`(select count(*) from ${courses} c where c.language_id = ${languages.id} and c.deleted_at is null)`.mapWith(Number),
        teacherCount: sql<number>`(select count(*) from ${teacherLanguages} tl join ${teachers} t on t.id = tl.teacher_id where tl.language_id = ${languages.id} and t.deleted_at is null)`.mapWith(Number),
      })
      .from(languages)
      .where(isNull(languages.deletedAt))
      .orderBy(asc(languages.name));
  }
}
