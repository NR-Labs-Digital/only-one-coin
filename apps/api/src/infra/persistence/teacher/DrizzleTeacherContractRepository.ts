import { teacherContracts } from "@ooc/db";
import { TeacherContract, TeacherContractAlreadyFiledError, type ITeacherContractRepository } from "@ooc/domain";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { isUniqueViolation } from "@/infra/db/isUniqueViolation.js";

type ContractRow = typeof teacherContracts.$inferSelect;

function toContract(row: ContractRow): TeacherContract {
  return new TeacherContract({
    id: row.id,
    teacherId: row.teacherId,
    objectKey: row.objectKey,
    fileName: row.fileName,
    fileSizeBytes: row.fileSizeBytes,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt,
  });
}

/**
 * `teacher_contracts`, append-only (0025): insert and read, nothing else. The
 * row's id is the upload id, so filing the same upload twice is refused by the
 * primary key and the unique `object_key` alike.
 */
export class DrizzleTeacherContractRepository implements ITeacherContractRepository {
  constructor(private readonly db: Db) {}

  async create(contract: TeacherContract): Promise<TeacherContract> {
    try {
      const [row] = await this.db
        .insert(teacherContracts)
        .values({
          id: contract.id,
          teacherId: contract.teacherId,
          objectKey: contract.objectKey,
          fileName: contract.fileName,
          fileSizeBytes: contract.fileSizeBytes,
          startsOn: contract.startsOn,
          endsOn: contract.endsOn,
          uploadedBy: contract.uploadedBy,
        })
        .returning();
      return toContract(row!);
    } catch (error) {
      if (
        isUniqueViolation(error, "teacher_contracts_pkey") ||
        isUniqueViolation(error, "teacher_contracts_object_key_uidx")
      ) {
        throw new TeacherContractAlreadyFiledError({ cause: error });
      }
      throw error;
    }
  }

  async findForTeacher(teacherId: string, contractId: string): Promise<TeacherContract | null> {
    const [row] = await this.db
      .select()
      .from(teacherContracts)
      .where(and(eq(teacherContracts.id, contractId), eq(teacherContracts.teacherId, teacherId)))
      .limit(1);
    return row ? toContract(row) : null;
  }
}
