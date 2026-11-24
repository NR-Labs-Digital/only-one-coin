import {
  GRADE_REGISTER_STATUSES,
  MAX_GRADE,
  MAX_REGISTER_RETURN_NOTE_LENGTH,
  MIN_GRADE,
  type GradeRegisterListRow,
  type GradeRegisterView,
} from "@ooc/domain";
import { z } from "zod";
import { container } from "@/container.js";
import { ClassGroupModuleParamsSchema, IdParamsSchema } from "@/http/catalog/CatalogSchemas.js";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { GRADE_READ_ROLES, GRADE_WRITE_ROLES } from "./gradeRoles.js";

/**
 * The grade register (OOC-180): the teacher changes grades while it is
 * theirs and sends it to review; coordination returns it with a note or
 * confirms it — its grades become official. The teacher's routes are scoped
 * like every `/teaching/*` read (another teacher's run is the same 404).
 */

const StepSchema = z.object({
  kind: z.enum(["submitted", "returned", "confirmed"]),
  /** ISO 8601, UTC. */
  at: z.string().datetime(),
  byName: z.string().nullable(),
  /** What coordination asked to correct — only on `returned`. */
  note: z.string().nullable(),
});

export const GradeRegisterSchema = z.object({
  /** Null while nothing of this round was posted yet. */
  registerId: z.string().uuid().nullable(),
  classGroupId: z.string().uuid(),
  classGroupModuleId: z.string().uuid(),
  round: z.number().int(),
  status: z.enum(GRADE_REGISTER_STATUSES),
  /** `YYYY-MM-DD`, a calendar day in Lima; null = no end date set. */
  moduleEndsOn: z.string().nullable(),
  /** ISO 8601, UTC; null without an end date. */
  deadlineAt: z.string().datetime().nullable(),
  overdue: z.boolean(),
  submittedLate: z.boolean(),
  graded: z.number().int(),
  total: z.number().int(),
  returnNote: z.string().nullable(),
  steps: z.array(StepSchema),
});

export function serializeRegister(view: GradeRegisterView): z.infer<typeof GradeRegisterSchema> {
  return {
    registerId: view.registerId,
    classGroupId: view.classGroupId,
    classGroupModuleId: view.classGroupModuleId,
    round: view.round,
    status: view.status,
    moduleEndsOn: view.moduleEndsOn,
    deadlineAt: view.deadlineAt ? view.deadlineAt.toISOString() : null,
    overdue: view.overdue,
    submittedLate: view.submittedLate,
    graded: view.graded,
    total: view.total,
    returnNote: view.returnNote,
    steps: view.steps.map((step) => ({
      kind: step.kind,
      at: step.at.toISOString(),
      byName: step.byName,
      note: step.note,
    })),
  };
}

// --- The teacher -----------------------------------------------------------

export const getOwnGradeRegisterRoute = RouteBuilder.get("/teaching/class-groups/:id/grade-register")
  .docs({ tags: ["Teaching"], summary: "The open grade register of one of the signed-in teacher's module runs" })
  .roles("teacher")
  .params(IdParamsSchema)
  .response(200, z.object({ register: GradeRegisterSchema }))
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const register = await container.useCases.teaching.getOwnGradeRegister.run({
      userId: request.currentUser!.id,
      classGroupId: request.params.id,
    });
    reply.status(200).send({ register: serializeRegister(register) });
  });

export const submitOwnGradeRegisterRoute = RouteBuilder.post("/teaching/class-groups/:id/grade-register/submit")
  .docs({
    tags: ["Teaching"],
    summary: "Send the run's grade register to review",
    description:
      "Only with every seat of the round graded (422 `teaching.grade_register_incomplete`) and from not sent or returned (422 `teaching.grade_register_wrong_status`).",
  })
  .roles("teacher")
  .params(IdParamsSchema)
  .response(200, z.object({ registerId: z.string().uuid() }))
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.teaching.submitOwnGradeRegister.run({
      userId: request.currentUser!.id,
      classGroupId: request.params.id,
    });
    reply.status(200).send(result);
  });

const SeatParamsSchema = z.object({ id: z.string().uuid(), enrollmentId: z.string().uuid() });

export const editOwnClassGroupGradeRoute = RouteBuilder.put("/teaching/class-groups/:id/grades/:enrollmentId")
  .docs({
    tags: ["Teaching"],
    summary: "Change a posted grade while the register is the teacher's",
    description:
      "Appends an edit to the grade's history — the posted value is kept. Only while the grade's register is not sent or returned (422 `teaching.grade_register_locked`). E-mails the student (and a minor's guardian) the new grade.",
  })
  .roles("teacher")
  .params(SeatParamsSchema)
  .body(z.object({ grade: z.union([z.number().min(MIN_GRADE).max(MAX_GRADE), z.literal("da")]) }))
  .response(200, z.object({ editId: z.string().uuid() }))
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.teaching.editOwnClassGroupGrade.run({
      userId: request.currentUser!.id,
      classGroupId: request.params.id,
      enrollmentId: request.params.enrollmentId,
      value: request.body.grade === "da" ? { kind: "did_not_sit" } : { kind: "score", score: request.body.grade },
    });
    reply.status(200).send(result);
  });

// --- Coordination ----------------------------------------------------------

export const listClassGroupGradeRegistersRoute = RouteBuilder.get("/catalog/class-groups/:id/grade-registers")
  .docs({ tags: ["Teaching"], summary: "Every grade register of a class group, per module run and round" })
  .roles(...GRADE_READ_ROLES)
  .params(IdParamsSchema)
  .response(200, z.object({ items: z.array(GradeRegisterSchema) }))
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const items = await container.useCases.teaching.listClassGroupGradeRegisters.run({ classGroupId: request.params.id });
    reply.status(200).send({ items: items.map(serializeRegister) });
  });

const ListRowSchema = GradeRegisterSchema.extend({
  classGroupCode: z.string(),
  classGroupStatus: z.string(),
  courseName: z.string(),
  academicPeriodId: z.string().uuid(),
  academicPeriodName: z.string(),
  module: z.number().int().nullable(),
  slots: z.unknown(),
  teacherId: z.string().uuid().nullable(),
  teacherName: z.string().nullable(),
});

function serializeRow(row: GradeRegisterListRow): z.infer<typeof ListRowSchema> {
  return {
    ...serializeRegister(row),
    classGroupCode: row.classGroupCode,
    classGroupStatus: row.classGroupStatus,
    courseName: row.courseName,
    academicPeriodId: row.academicPeriodId,
    academicPeriodName: row.academicPeriodName,
    module: row.module,
    slots: row.slots,
    teacherId: row.teacherId,
    teacherName: row.teacherName,
  };
}

export const listGradeRegistersRoute = RouteBuilder.get("/grade-registers")
  .docs({
    tags: ["Teaching"],
    summary: "Grade registers pending review and out of time, across class groups",
    description:
      "One row per register, plus the round the next grade would open in each run with ungraded seats. Only class groups running or finished.",
  })
  .roles(...GRADE_READ_ROLES)
  .query(
    z.object({
      period: z.string().uuid().optional(),
      teacher: z.string().uuid().optional(),
      module: z.coerce.number().int().positive().optional(),
      status: z.enum(GRADE_REGISTER_STATUSES).optional(),
      overdue: z.enum(["true", "false"]).optional(),
    }),
  )
  .response(200, z.object({ items: z.array(ListRowSchema), submissionHours: z.number().int() }))
  .handler(async (request, reply) => {
    const query = request.query;
    const result = await container.useCases.teaching.listGradeRegisters.run({
      academicPeriodId: query.period ?? null,
      teacherId: query.teacher ?? null,
      module: query.module ?? null,
      status: query.status ?? null,
      overdueOnly: query.overdue === "true",
    });
    reply.status(200).send({ items: result.rows.map(serializeRow), submissionHours: result.submissionHours });
  });

export const returnGradeRegisterRoute = RouteBuilder.post("/catalog/class-groups/:id/modules/:moduleId/grade-register/return")
  .docs({
    tags: ["Teaching"],
    summary: "Return a grade register in review to its teacher, saying what to correct",
  })
  .roles(...GRADE_WRITE_ROLES)
  .params(ClassGroupModuleParamsSchema)
  .body(z.object({ note: z.string().max(MAX_REGISTER_RETURN_NOTE_LENGTH * 2) }))
  .response(200, z.object({ registerId: z.string().uuid() }))
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.teaching.returnGradeRegister.run({
      actorId: request.currentUser!.id,
      classGroupId: request.params.id,
      classGroupModuleId: request.params.moduleId,
      note: request.body.note,
    });
    reply.status(200).send(result);
  });

export const confirmGradeRegisterRoute = RouteBuilder.post("/catalog/class-groups/:id/modules/:moduleId/grade-register/confirm")
  .docs({
    tags: ["Teaching"],
    summary: "Confirm a grade register: its grades become official",
    description:
      "From any open state, with every seat of the round graded. E-mails each student (and a minor's guardian) the official grade.",
  })
  .roles(...GRADE_WRITE_ROLES)
  .params(ClassGroupModuleParamsSchema)
  .response(200, z.object({ registerId: z.string().uuid() }))
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.teaching.confirmGradeRegister.run({
      actorId: request.currentUser!.id,
      classGroupId: request.params.id,
      classGroupModuleId: request.params.moduleId,
    });
    reply.status(200).send(result);
  });
