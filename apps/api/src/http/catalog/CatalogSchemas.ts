import { CertificateRuleSchema, ClassGroupStatusSchema, LandingCourseKeySchema, WeeklySlotSchema as ValidWeeklySlotSchema } from "@ooc/domain";
import { z } from "zod";

export const IdParamsSchema = z.object({ id: z.string().uuid() });

/** Every catalog write answers the id it touched; the screen re-reads. */
export const IdResponseSchema = z.object({ id: z.string().uuid() });

export const CourseListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  language: z.string(),
  languageId: z.string().uuid().nullable(),
  level: z.string(),
  summary: z.string(),
  minAge: z.number().int(),
  modules: z.number().int(),
  moduleMaterials: z.array(z.string()),
  missingModuleMaterials: z.boolean(),
  totalHours: z.number().int(),
  certificateRule: CertificateRuleSchema,
  allowsFreeze: z.boolean(),
  allowsTransfer: z.boolean(),
  landingKey: LandingCourseKeySchema.nullable(),
  active: z.boolean(),
  classGroupCount: z.number().int(),
  planCount: z.number().int(),
  hasPriceInForce: z.boolean(),
});

export const PlanDetailSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  active: z.boolean(),
  currentPriceId: z.string().uuid().nullable(),
  prices: z.array(
    z.object({
      id: z.string().uuid(),
      amountCents: z.number().int(),
      validFrom: z.string().datetime(),
      createdAt: z.string().datetime(),
    }),
  ),
});

/** A price as the screen sends it — whole cents, and an optional start. */
export const PriceBodySchema = z.object({
  amountCents: z.number().int().positive(),
  validFrom: z.string().datetime({ offset: true }).optional(),
});

/** One weekly meeting of a class group, as `class_groups.slots` stores it (jsonb). */
export const WeeklySlotSchema = z.object({
  weekday: z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
  startTime: z.string(),
  endTime: z.string(),
});

export const PeriodListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  startsOn: z.string().datetime(),
  endsOn: z.string().datetime(),
  active: z.boolean(),
  classGroupCount: z.number().int(),
});

export const ClassGroupItemSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  courseId: z.string().uuid(),
  courseName: z.string(),
  language: z.string(),
  courseActive: z.boolean(),
  academicPeriodId: z.string().uuid(),
  academicPeriodName: z.string(),
  teacherId: z.string().uuid().nullable(),
  teacherName: z.string(),
  legacyTeacherName: z.string(),
  classroomUrl: z.string().nullable(),
  module: z.number().int().nullable(),
  slots: z.array(WeeklySlotSchema),
  startsOn: z.string().datetime().nullable(),
  endsOn: z.string().datetime().nullable(),
  enrollmentOpensAt: z.string().datetime().nullable(),
  enrollmentClosesAt: z.string().datetime().nullable(),
  capacity: z.number().int(),
  seatsTaken: z.number().int(),
  status: ClassGroupStatusSchema,
  active: z.boolean(),
  waitlistCount: z.number().int(),
});

export const WaitlistItemSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
  studentName: z.string(),
  nationalIdType: z.string(),
  nationalId: z.string(),
  joinedAt: z.string().datetime(),
});

/** A date as the screen sends it: ISO 8601 with an offset (midnight America/Lima is -05:00). */
export const DateTimeSchema = z.string().datetime({ offset: true });

/** Optional on create; on PATCH an explicit null clears the field. */
export const DateTimeOrNull = DateTimeSchema.nullable().optional();

export const toDate = (value: string | null | undefined): Date | null | undefined =>
  value === undefined ? undefined : value === null ? null : new Date(value);

export const CreateClassGroupBodySchema = z.object({
  courseId: z.string().uuid(),
  academicPeriodId: z.string().uuid(),
  /** From the roster (OOC-80); null on edit takes the allocation away. */
  teacherId: z.string().uuid().nullable().optional(),
  /** The Google Classroom (OOC-98); the domain checks the host. Null or blank clears it. */
  classroomUrl: z.string().max(2048).nullable().optional(),
  /** Which of the course's modules it teaches (OOC-100); the domain checks the upper bound. Null clears it. */
  module: z.number().int().positive().nullable().optional(),
  slots: z.array(ValidWeeklySlotSchema).min(1),
  capacity: z.number().int().positive(),
  startsOn: DateTimeOrNull,
  endsOn: DateTimeOrNull,
  enrollmentOpensAt: DateTimeOrNull,
  enrollmentClosesAt: DateTimeOrNull,
  publish: z.boolean(),
});

export const UpdateClassGroupBodySchema = CreateClassGroupBodySchema.omit({ academicPeriodId: true, publish: true })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0);
