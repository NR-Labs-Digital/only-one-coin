import { teacherAvailability, teacherContracts } from "@ooc/db";
import type { WeeklySlot } from "@ooc/domain";
import { asc, desc, eq } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import type { ClassGroupItem, ListClassGroupsQuery } from "@/infra/persistence/catalog/ListClassGroupsQuery.js";
import { toHourMinute } from "./DrizzleTeacherRepository.js";
import type { ListTeachersQuery, TeacherContractSummary, TeacherListRow } from "./ListTeachersQuery.js";

export interface TeacherDetail extends TeacherListRow {
  availability: WeeklySlot[];
  /** Every class group allocated to them, retired ones included and flagged. */
  classGroups: ClassGroupItem[];
  /** Every filing, newest first — the first one is `contract` (OOC-81). */
  contracts: TeacherContractSummary[];
}

/**
 * One teacher's file (OOC-78): the roster row, the week they declared and the
 * class groups already on them — read together, because the file answers
 * "where does the next class group fit".
 */
export class GetTeacherQuery {
  constructor(
    private readonly db: Db,
    private readonly teachers: ListTeachersQuery,
    private readonly classGroups: ListClassGroupsQuery,
  ) {}

  async run(id: string): Promise<TeacherDetail | null> {
    const row = await this.teachers.byId(id);
    if (!row) return null;

    const [availability, classGroups, contracts] = await Promise.all([
      this.db
        .select({
          weekday: teacherAvailability.weekday,
          startTime: teacherAvailability.startTime,
          endTime: teacherAvailability.endTime,
        })
        .from(teacherAvailability)
        .where(eq(teacherAvailability.teacherId, id))
        .orderBy(asc(teacherAvailability.weekday), asc(teacherAvailability.startTime)),
      this.classGroups.run({ teacherId: id }),
      this.db
        .select({
          id: teacherContracts.id,
          fileName: teacherContracts.fileName,
          fileSizeBytes: teacherContracts.fileSizeBytes,
          uploadedAt: teacherContracts.createdAt,
          startsOn: teacherContracts.startsOn,
          endsOn: teacherContracts.endsOn,
        })
        .from(teacherContracts)
        .where(eq(teacherContracts.teacherId, id))
        .orderBy(desc(teacherContracts.createdAt), desc(teacherContracts.id)),
    ]);

    return {
      ...row,
      availability: availability.map((slot) => ({
        weekday: slot.weekday as WeeklySlot["weekday"],
        startTime: toHourMinute(slot.startTime),
        endTime: toHourMinute(slot.endTime),
      })),
      classGroups,
      contracts,
    };
  }
}
