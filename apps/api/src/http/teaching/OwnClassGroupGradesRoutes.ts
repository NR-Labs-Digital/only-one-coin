import { MAX_GRADE, MIN_GRADE, type GradeEntry, type RecordedGrade } from "@ooc/domain";
import { z } from "zod";
import { container } from "@/container.js";
import { IdParamsSchema } from "@/http/catalog/CatalogSchemas.js";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";

/** One seat's grade as it counts: the final exam's, or DA in its place (`grade: null`). */
export const RecordedGradeSchema = z.object({
  enrollmentId: z.string().uuid(),
  grade: z.number().nullable(),
  didNotSit: z.boolean(),
  /** When it was first posted — ISO 8601, UTC. */
  recordedAt: z.string().datetime(),
  /** When the supervision last corrected it (OOC-102); null = as posted. */
  correctedAt: z.string().datetime().nullable(),
});

export function serializeGrade(grade: RecordedGrade): z.infer<typeof RecordedGradeSchema> {
  return {
    enrollmentId: grade.enrollmentId,
    grade: grade.value.kind === "score" ? grade.value.score : null,
    didNotSit: grade.value.kind === "did_not_sit",
    recordedAt: grade.recordedAt.toISOString(),
    correctedAt: grade.correctedAt ? grade.correctedAt.toISOString() : null,
  };
}

/** What a posting answers: written now, skipped as a retry, and whether it finished the module (OOC-102). */
export const RecordGradesResponseSchema = z.object({
  recorded: z.number().int(),
  alreadyRecorded: z.number().int(),
  finished: z.boolean(),
});

// The grades already posted in one of the teacher's class groups (OOC-38).
// Another teacher's class group answers 404, like reading it.
export const listOwnClassGroupGradesRoute = RouteBuilder.get("/teaching/class-groups/:id/grades")
  .docs({
    tags: ["Teaching"],
    summary: "The final grades posted in one of the signed-in teacher's class groups",
  })
  .roles("teacher")
  .params(IdParamsSchema)
  .response(200, z.object({ items: z.array(RecordedGradeSchema) }))
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const items = await container.useCases.teaching.listOwnClassGroupGrades.run({
      userId: request.currentUser!.id,
      classGroupId: request.params.id,
    });
    reply.status(200).send({ items: items.map(serializeGrade) });
  });

export const GradeEntrySchema = z.object({
  enrollmentId: z.string().uuid(),
  /** The final exam's grade, or `"da"` for the exam not sat. */
  grade: z.union([z.number().min(MIN_GRADE).max(MAX_GRADE), z.literal("da")]),
});

export function toGradeEntry(entry: z.infer<typeof GradeEntrySchema>): GradeEntry {
  return {
    enrollmentId: entry.enrollmentId,
    value: entry.grade === "da" ? { kind: "did_not_sit" } : { kind: "score", score: entry.grade },
  };
}

// Posting final grades — one, or the sheet's batch (OOC-38). Final once
// posted; the same value again is a no-op, so a sheet that lost its
// connection resends safely.
export const recordOwnClassGroupGradesRoute = RouteBuilder.post("/teaching/class-groups/:id/grades")
  .docs({
    tags: ["Teaching"],
    summary: "Post final grades in one of the signed-in teacher's class groups",
    description:
      "One grade per confirmed seat, final once posted. Resending the same value is a no-op; a different value on a graded seat is 409 and nothing is written. The batch that leaves every confirmed seat graded moves an in-progress class group to finished.",
  })
  .roles("teacher")
  .params(IdParamsSchema)
  .body(z.object({ entries: z.array(GradeEntrySchema).min(1).max(500) }))
  .response(200, RecordGradesResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const entries = request.body.entries.map(toGradeEntry);
    const result = await container.useCases.teaching.recordOwnClassGroupGrades.run({
      userId: request.currentUser!.id,
      classGroupId: request.params.id,
      entries,
    });
    reply.status(200).send(result);
  });
