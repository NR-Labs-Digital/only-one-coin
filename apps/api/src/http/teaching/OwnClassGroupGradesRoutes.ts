import { MAX_GRADE, MIN_GRADE, type GradeEntry, type RecordedGrade } from "@ooc/domain";
import { z } from "zod";
import { container } from "@/container.js";
import { IdParamsSchema } from "@/http/catalog/CatalogSchemas.js";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";

/** One posted grade: the final exam's, or DA in its place (`grade: null`). */
const RecordedGradeSchema = z.object({
  enrollmentId: z.string().uuid(),
  grade: z.number().nullable(),
  didNotSit: z.boolean(),
  /** ISO 8601, UTC. */
  recordedAt: z.string().datetime(),
});

function serializeGrade(grade: RecordedGrade): z.infer<typeof RecordedGradeSchema> {
  return {
    enrollmentId: grade.enrollmentId,
    grade: grade.value.kind === "score" ? grade.value.score : null,
    didNotSit: grade.value.kind === "did_not_sit",
    recordedAt: grade.recordedAt.toISOString(),
  };
}

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

const GradeEntrySchema = z.object({
  enrollmentId: z.string().uuid(),
  /** The final exam's grade, or `"da"` for the exam not sat. */
  grade: z.union([z.number().min(MIN_GRADE).max(MAX_GRADE), z.literal("da")]),
});

// Posting final grades — one, or the sheet's batch (OOC-38). Final once
// posted; the same value again is a no-op, so a sheet that lost its
// connection resends safely.
export const recordOwnClassGroupGradesRoute = RouteBuilder.post("/teaching/class-groups/:id/grades")
  .docs({
    tags: ["Teaching"],
    summary: "Post final grades in one of the signed-in teacher's class groups",
    description:
      "One grade per confirmed seat, final once posted. Resending the same value is a no-op; a different value on a graded seat is 409 and nothing is written.",
  })
  .roles("teacher")
  .params(IdParamsSchema)
  .body(z.object({ entries: z.array(GradeEntrySchema).min(1).max(500) }))
  .response(200, z.object({ recorded: z.number().int(), alreadyRecorded: z.number().int() }))
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const entries: GradeEntry[] = request.body.entries.map((entry) => ({
      enrollmentId: entry.enrollmentId,
      value: entry.grade === "da" ? { kind: "did_not_sit" } : { kind: "score", score: entry.grade },
    }));
    const result = await container.useCases.teaching.recordOwnClassGroupGrades.run({
      userId: request.currentUser!.id,
      classGroupId: request.params.id,
      entries,
    });
    reply.status(200).send(result);
  });
