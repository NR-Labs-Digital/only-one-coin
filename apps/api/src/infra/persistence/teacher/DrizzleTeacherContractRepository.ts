import { teacherContracts } from "@ooc/db";
import { TeacherContract, type ITeacherContractRepository } from "@ooc/domain";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

type ContractRow = typeof teacherContracts.$inferSelect;

function toContract(row: ContractRow): TeacherContract {
  return new TeacherContract({
    id: row.id,
    teacherId: row.teacherId,
    // The 0035 CHECK keeps the three together; a row has all of them or none.
    file:
      row.objectKey !== null && row.fileName !== null && row.fileSizeBytes !== null
        ? { objectKey: row.objectKey, fileName: row.fileName, fileSizeBytes: row.fileSizeBytes }
        : null,
    templateVersionId: row.templateVersionId,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    recordedBy: row.uploadedBy,
    createdAt: row.createdAt,
  });
}

/** `teacher_contracts`, append-only (0025): insert and read, nothing else. */
export class DrizzleTeacherContractRepository implements ITeacherContractRepository {
  constructor(private readonly db: Db) {}

  async create(contract: TeacherContract): Promise<TeacherContract> {
    const [row] = await this.db
      .insert(teacherContracts)
      .values({
        id: contract.id,
        teacherId: contract.teacherId,
        objectKey: contract.file?.objectKey ?? null,
        fileName: contract.file?.fileName ?? null,
        fileSizeBytes: contract.file?.fileSizeBytes ?? null,
        templateVersionId: contract.templateVersionId,
        startsOn: contract.startsOn,
        endsOn: contract.endsOn,
        uploadedBy: contract.recordedBy,
      })
      .returning();
    return toContract(row!);
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
