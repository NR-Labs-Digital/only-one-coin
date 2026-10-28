import { ClassGroupStatusSchema, type TeachingClassGroup } from "@ooc/domain";
import { z } from "zod";
import { WeeklySlotSchema } from "@/http/catalog/CatalogSchemas.js";

/**
 * A class group as the docente portal reads it. `teacherId` stays behind: it
 * is the check, not something the screen needs — the teacher is the reader.
 */
export const TeachingClassGroupSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  courseName: z.string(),
  language: z.string(),
  academicPeriodName: z.string(),
  slots: z.array(WeeklySlotSchema),
  /** ISO 8601, UTC — rendered in America/Lima by the screen. */
  startsOn: z.string().datetime().nullable(),
  endsOn: z.string().datetime().nullable(),
  capacity: z.number().int(),
  seatsTaken: z.number().int(),
  status: ClassGroupStatusSchema,
  /** The class group's Google Classroom (OOC-98); null = coordination has not pasted it yet. */
  classroomUrl: z.string().nullable(),
  /** Which of the course's modules it teaches (OOC-100); null = coordination has not set it. */
  module: z.number().int().nullable(),
  /** That module's material, from the course (OOC-100); null = nothing to open. */
  moduleMaterialUrl: z.string().nullable(),
});

export function serializeTeachingClassGroup(group: TeachingClassGroup): z.infer<typeof TeachingClassGroupSchema> {
  return {
    id: group.id,
    code: group.code,
    courseName: group.courseName,
    language: group.language,
    academicPeriodName: group.academicPeriodName,
    slots: group.slots,
    startsOn: group.startsOn?.toISOString() ?? null,
    endsOn: group.endsOn?.toISOString() ?? null,
    capacity: group.capacity,
    seatsTaken: group.seatsTaken,
    status: group.status,
    classroomUrl: group.classroomUrl,
    module: group.module,
    moduleMaterialUrl: group.moduleMaterialUrl,
  };
}
