import type { NationalIdType } from "../student/fields.js";
import type { Teacher } from "./Teacher.js";

/**
 * Deliberately narrow, like the student's: the database refuses DELETE on
 * `teachers` (0025), so a generic delete() has no place in the contract.
 * Languages and availability travel inside the aggregate — the repository
 * writes them with the row.
 */
export interface ITeacherRepository {
  /** Throws `TeacherAlreadyRegisteredError` when the unique index refuses the document. */
  create(teacher: Teacher): Promise<Teacher>;

  /** A live record by id — a retired one does not answer. */
  findById(id: string): Promise<Teacher | null>;

  /** The live teacher behind a document, if any. */
  findByNationalId(params: { nationalIdType: NationalIdType; nationalId: string }): Promise<Teacher | null>;

  /** The live teacher whose panel account this is (`teachers.user_id`, OOC-79), if any. */
  findByUserId(userId: string): Promise<Teacher | null>;

  /**
   * Writes `teachers.user_id` onto a live file that has no account yet — the
   * accepted teacher invite (OOC-79). Answers false, writing nothing, when the
   * file is gone or already linked: a link never moves between accounts.
   */
  linkAccount(teacherId: string, userId: string): Promise<boolean>;

  /** Writes the entity's current fields, languages and availability over its rows. */
  update(teacher: Teacher): Promise<Teacher>;

  /**
   * Class groups still enrolling or running with this teacher on them — what
   * leaving the roster warns about (CLAUDE.md §1, "avisa, não bloqueia").
   */
  countRunningClassGroups(teacherId: string): Promise<number>;
}
