import { MAX_CORRECTION_REASON_LENGTH, MAX_GRADE, MIN_GRADE, type GradeWithHistory } from "@ooc/domain";
import { z } from "zod";
import { container } from "@/container.js";
import { IdParamsSchema } from "@/http/catalog/CatalogSchemas.js";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { GRADE_READ_ROLES, GRADE_WRITE_ROLES } from "./gradeRoles.js";
import {
  GradeEntrySchema,
  RecordGradesResponseSchema,
  RecordedGradeSchema,
  serializeGrade,
  toGradeEntry,
} from "./OwnClassGroupGradesRoutes.js";

/**
 * The academic supervision's grades (OOC-102): any class group, not scoped to
 * a teacher. Reading is for the supervision, management and the analyst;
 * posting and correcting is for the supervision and management
 * (`gradeRoles.ts`).
 */

const HistoryEntrySchema = z.object({
  grade: z.number().nullable(),
  didNotSit: z.boolean(),
  /** ISO 8601, UTC. */
  at: z.string().datetime(),
  /** Who did it; null when the account has no name to show. */
  byName: z.string().nullable(),
  /** Why it was corrected; null on the posting itself. */
  reason: z.string().nullable(),
});

const SheetSeatSchema = z.object({
  enrollmentId: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  /** Null while no grade was posted for the seat. */
  grade: RecordedGradeSchema.extend({ history: z.array(HistoryEntrySchema) }).nullable(),
});

function serializeWithHistory(grade: GradeWithHistory) {
  return {
    ...serializeGrade(grade),
    history: grade.history.map((entry) => ({
      grade: entry.value.kind === "score" ? entry.value.score : null,
      didNotSit: entry.value.kind === "did_not_sit",
      at: entry.at.toISOString(),
      byName: entry.byName,
      reason: entry.reason,
    })),
  };
}

export const listClassGroupGradesRoute = RouteBuilder.get("/catalog/class-groups/:id/grades")
  .docs({
    tags: ["Teaching"],
    summary: "A class group's grade sheet, with each grade's history",
    description: "Every confirmed seat, graded or not. The grades are the ones that count — a correction replaces the posted value here.",
  })
  .roles(...GRADE_READ_ROLES)
  .params(IdParamsSchema)
  .response(200, z.object({ seats: z.array(SheetSeatSchema) }))
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const sheet = await container.useCases.teaching.listClassGroupGrades.run({ classGroupId: request.params.id });
    reply.status(200).send({
      seats: sheet.seats.map((seat) => ({
        enrollmentId: seat.enrollmentId,
        firstName: seat.firstName,
        lastName: seat.lastName,
        grade: seat.grade ? serializeWithHistory(seat.grade) : null,
      })),
    });
  });

export const recordClassGroupGradesRoute = RouteBuilder.post("/catalog/class-groups/:id/grades")
  .docs({
    tags: ["Teaching"],
    summary: "Post the grades still missing in a class group, as the academic supervision",
    description:
      "The same rules as the teacher's sheet: final once posted, the same value again is a no-op, a different value on a graded seat is 409 — changing a grade is a correction.",
  })
  .roles(...GRADE_WRITE_ROLES)
  .params(IdParamsSchema)
  .body(z.object({ entries: z.array(GradeEntrySchema).min(1).max(500) }))
  .response(200, RecordGradesResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.teaching.recordClassGroupGrades.run({
      actorId: request.currentUser!.id,
      classGroupId: request.params.id,
      entries: request.body.entries.map(toGradeEntry),
    });
    reply.status(200).send(result);
  });

const CorrectionParamsSchema = z.object({
  id: z.string().uuid(),
  enrollmentId: z.string().uuid(),
});

export const correctClassGroupGradeRoute = RouteBuilder.post("/catalog/class-groups/:id/grades/:enrollmentId/correction")
  .docs({
    tags: ["Teaching"],
    summary: "Correct a posted grade, with a reason",
    description:
      "Appends a correction — the posted grade and earlier corrections are kept. E-mails the student (and a minor's guardian) the new grade.",
  })
  .roles(...GRADE_WRITE_ROLES)
  .params(CorrectionParamsSchema)
  .body(
    z.object({
      grade: z.union([z.number().min(MIN_GRADE).max(MAX_GRADE), z.literal("da")]),
      reason: z.string().max(MAX_CORRECTION_REASON_LENGTH * 2),
    }),
  )
  .response(201, z.object({ correctionId: z.string().uuid() }))
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.teaching.correctClassGroupGrade.run({
      actorId: request.currentUser!.id,
      classGroupId: request.params.id,
      enrollmentId: request.params.enrollmentId,
      value: request.body.grade === "da" ? { kind: "did_not_sit" } : { kind: "score", score: request.body.grade },
      reason: request.body.reason,
    });
    reply.status(201).send(result);
  });
