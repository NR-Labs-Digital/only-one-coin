import type { ClassroomAccount } from "./ClassroomAccount.js";

/** No delete: an account leaves through `retire` (deleted_at). */
export interface IClassroomAccountRepository {
  /** Refuses with ClassroomAccountExistsError when a live account has the e-mail (any case). */
  create(account: ClassroomAccount): Promise<void>;
  /** Live accounts only. */
  findById(id: string): Promise<ClassroomAccount | null>;
  /** E-mail, sealed password and its date. Same refusal as `create` for the e-mail. */
  update(account: ClassroomAccount): Promise<void>;
  /** Live teachers that use the account now. */
  countTeachers(id: string): Promise<number>;
  /** Re-counts under a lock and refuses with ClassroomAccountInUseError when a teacher got there first. */
  retire(account: ClassroomAccount): Promise<void>;
}

/**
 * Seals and opens a secret the platform has to show back (OOC-196) — the
 * shared Classroom password. Throws ClassroomCredentialsUnavailableError when
 * no key is configured: nothing is ever stored in clear.
 */
export interface ICredentialCipher {
  seal(plain: string): string;
  open(sealed: string): string;
}
