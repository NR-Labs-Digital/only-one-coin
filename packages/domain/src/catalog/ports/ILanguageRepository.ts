import type { Language } from "../Language.js";

/**
 * No delete: a language leaves through `retire` (deleted_at), like every other
 * catalog entry. `findById` answers retired rows too.
 */
export interface ILanguageRepository {
  /** Refuses with LanguageExistsError when a live language has the same key. */
  create(language: Language): Promise<void>;
  findById(id: string): Promise<Language | null>;
  /**
   * Writes the new name, and the same name over the text every course and
   * teacher of this language still carries (courses.language,
   * teacher_languages.language) — in one transaction.
   */
  rename(language: Language): Promise<void>;
  /** Live courses still filed under the language. */
  countLiveCourses(id: string): Promise<number>;
  /** Sets deleted_at and lets every teacher go of it. Answers how many teachers held it. */
  retire(language: Language): Promise<number>;
}
