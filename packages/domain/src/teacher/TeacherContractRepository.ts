import type { TeacherContract } from "./TeacherContract.js";

/**
 * Append-only, like the table (0025): the database refuses UPDATE and DELETE
 * on `teacher_contracts`, so the port has neither.
 */
export interface ITeacherContractRepository {
  create(contract: TeacherContract): Promise<TeacherContract>;

  /** One contract of this teacher — a contract of another teacher does not answer. */
  findForTeacher(teacherId: string, contractId: string): Promise<TeacherContract | null>;
}
