import type { NationalIdType, Student } from "./Student.js";

/**
 * Deliberately narrow — NOT IBaseRepository<Student>. There is no grant of
 * DELETE on students (CLAUDE.md §6, "sem grant de DELETE em student"), so a
 * generic delete() has no business being part of this contract.
 */
export interface IStudentRepository {
  create(student: Student): Promise<Student>;

  /**
   * The person behind a document, if the institution already knows them.
   *
   * A document identifies one human being, so it is the only handle that
   * survives a name typed differently or an e-mail that changed: CLAUDE.md §1
   * requires a returning student to come back to their own record, "nunca
   * duplicando `student`". Soft-deleted rows do not answer — a record somebody
   * retired must not silently reappear under a new enrollment.
   */
  findByNationalId(params: {
    nationalIdType: NationalIdType;
    nationalId: string;
  }): Promise<Student | null>;
}
