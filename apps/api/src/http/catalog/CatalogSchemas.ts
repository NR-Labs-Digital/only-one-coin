import {
  CertificateRuleSchema,
  ClassGroupStatusSchema,
  ClassroomLinkPatchSchema,
  LandingCourseKeySchema,
  WeeklySlotSchema as ValidWeeklySlotSchema,
} from "@ooc/domain";
import { z } from "zod";

/** A Classroom quick link (OOC-144): `module` is null only for the old single link of a class group with no module set. */
export const ClassroomLinkSchema = z.object({ module: z.number().int().positive().nullable(), url: z.string() });

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
  allowsEnrollmentTransfer: z.boolean(),
  landingKey: LandingCourseKeySchema.nullable(),
  active: z.boolean(),
  classGroupCount: z.number().int(),
  planCount: z.number().int(),
  hasPriceInForce: z.boolean(),
});

export const PlanDetailSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  billing: z.enum(["package", "monthly"]),
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

/** One module run of a class group (OOC-156): its own teacher, schedule and Classroom. */
export const ClassGroupModuleItemSchema = z.object({
  id: z.string().uuid(),
  module: z.number().int().nullable(),
  fullCourse: z.boolean(),
  teacherId: z.string().uuid().nullable(),
  teacherName: z.string(),
  legacyTeacherName: z.string(),
  slots: z.array(WeeklySlotSchema),
  classroomUrl: z.string().nullable(),
  classroomLinksByModule: z.record(z.string(), z.string()),
  classroomLinks: z.array(ClassroomLinkSchema),
  classroomMissing: z.boolean(),
  /** Its Google Meet (OOC-159); null = nobody pasted one yet. */
  meetUrl: z.string().nullable(),
  /** Confirmed seats in the run now. */
  students: z.number().int(),
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
  /** Every live module run, in module order (OOC-156); the first is where a new student starts. */
  modules: z.array(ClassGroupModuleItemSchema),
  /** The fields from here to `slots` repeat the first run — a class group of one run reads them as before. */
  teacherId: z.string().uuid().nullable(),
  teacherName: z.string(),
  legacyTeacherName: z.string(),
  /** The one link pasted before OOC-144 — read-only, for a class group with no module set. */
  classroomUrl: z.string().nullable(),
  /** Every module's stored Classroom (OOC-144), module number → link — what the form edits. */
  classroomLinksByModule: z.record(z.string(), z.string()),
  /** The links of the modules it teaches, in order. */
  classroomLinks: z.array(ClassroomLinkSchema),
  /** Some run of the class group is missing a Classroom. */
  classroomMissing: z.boolean(),
  /** The first run's Meet (OOC-159) — what the form of a one-run class group edits. */
  meetUrl: z.string().nullable(),
  /** Some run of the class group has no teacher yet. */
  teacherMissing: z.boolean(),
  module: z.number().int().nullable(),
  fullCourse: z.boolean(),
  slots: z.array(WeeklySlotSchema),
  startsOn: z.string().datetime().nullable(),
  endsOn: z.string().datetime().nullable(),
  enrollmentOpensAt: z.string().datetime().nullable(),
  enrollmentClosesAt: z.string().datetime().nullable(),
  capacity: z.number().int(),
  seatsTaken: z.number().int(),
  // Seats held above capacity (OOC-155), the "+2" of "30/30 +2".
  seatsOver: z.number().int(),
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
  /**
   * One Classroom per module (OOC-144): each entry sets that module's link, a
   * null or blank url clears it, modules not named keep theirs. The domain
   * checks the host and that the module is one of the course's.
   */
  classroomLinks: z.array(ClassroomLinkPatchSchema).max(50).optional(),
  /**
   * The module group's Google Meet (OOC-159); null or blank clears it. The
   * domain checks the host (https on meet.google.com). Ignored on a full
   * course: each of its runs gets its own.
   */
  meetUrl: z.string().max(2000).nullable().optional(),
  /** Which of the course's modules it teaches (OOC-100); the domain checks the upper bound. Null clears it. */
  module: z.number().int().positive().nullable().optional(),
  /** Teaches every module of the course (OOC-130); wins over `module`. */
  fullCourse: z.boolean().optional(),
  slots: z.array(ValidWeeklySlotSchema).min(1),
  capacity: z.number().int().positive(),
  startsOn: DateTimeOrNull,
  endsOn: DateTimeOrNull,
  enrollmentOpensAt: DateTimeOrNull,
  enrollmentClosesAt: DateTimeOrNull,
  publish: z.boolean(),
});

/**
 * The class group's own fields, plus — for a class group of a single module
 * run — that run's (teacher, module, schedule, Classroom), the way the form
 * always edited them (OOC-156). With more than one run those go to the run's
 * route; sending them here is 422 `catalog.class_group_module_ambiguous`.
 */
export const UpdateClassGroupBodySchema = CreateClassGroupBodySchema.omit({ academicPeriodId: true, publish: true })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0);

/** The run's fields — opening another run of a class group, or (partial) editing one. */
export const CreateClassGroupModuleBodySchema = CreateClassGroupBodySchema.pick({
  teacherId: true,
  classroomLinks: true,
  meetUrl: true,
  module: true,
  fullCourse: true,
  slots: true,
});

export const UpdateClassGroupModuleBodySchema = CreateClassGroupModuleBodySchema.partial().refine(
  (patch) => Object.keys(patch).length > 0,
);

export const ClassGroupModuleParamsSchema = z.object({ id: z.string().uuid(), moduleId: z.string().uuid() });
