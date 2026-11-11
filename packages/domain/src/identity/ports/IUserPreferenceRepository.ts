import type { Locale } from "../../notification/EmailNotification.js";

/**
 * What an account chose about itself on its own profile (OOC-150) — today
 * only the language. Read and written by the session's own user id, never by
 * an id from the client (CLAUDE.md §8, anti-IDOR).
 *
 * Narrow on purpose, like `IUserRoleRepository`: no generic update on
 * Better Auth's "user" row.
 */
export interface IUserPreferenceRepository {
  /** Null when the account never chose one. */
  findPreferredLocale(userId: string): Promise<Locale | null>;
  setPreferredLocale(userId: string, locale: Locale): Promise<void>;
}
