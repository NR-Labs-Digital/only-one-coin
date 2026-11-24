import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { STUDENT_FILE_ROLES } from "./studentRoles.js";

const StudentParamsSchema = z.object({ studentId: z.string().uuid() });

// Opaque, server-issued — a tampered value restarts from the newest entry.
const ActivityQuerySchema = z.object({ cursor: z.string().trim().min(1).optional() });

const FieldSchema = z.enum([
  "first_name",
  "last_name",
  "id_type",
  "id_number",
  "email",
  "phone",
  "birth_date",
  "country",
  "region",
  "city",
  "relationship",
]);

const ActivityResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      at: z.string(),
      action: z.enum([
        "student_registered",
        "student_updated",
        "guardian_added",
        "guardian_updated",
        "guardian_consent_accepted",
        "student_phone_self_updated",
        "enrollment_created",
        "payment_approved",
        "payment_rejected",
        "receipt_viewed",
      ]),
      actorName: z.string().nullable(),
      actorRole: z.string().nullable(),
      reference: z
        .discriminatedUnion("kind", [
          z.object({ kind: z.literal("course"), name: z.string() }),
          z.object({ kind: z.literal("operation"), number: z.string() }),
          z.object({ kind: z.literal("fields"), fields: z.array(FieldSchema) }),
        ])
        .nullable(),
    }),
  ),
  nextCursor: z.string().nullable(),
});

/**
 * The student file's activity tab (OOC-75) — the `audit_log` read for one
 * person, a page at a time. Read, never edited: the log is append-only.
 */
export const listStudentActivityRoute = RouteBuilder.get("/students/:studentId/activity")
  .docs({
    tags: ["Students"],
    summary: "A student's activity",
    description: "audit_log entries about the student, their enrollments and their payments, newest first.",
  })
  .roles(...STUDENT_FILE_ROLES)
  .params(StudentParamsSchema)
  .query(ActivityQuerySchema)
  .response(200, ActivityResponseSchema)
  .response(400, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const page = await container.queries.studentActivity.run(request.params.studentId, request.query.cursor);

    reply.status(200).send({
      items: page.items.map((item) => ({ ...item, at: item.at.toISOString() })),
      nextCursor: page.nextCursor,
    });
  });
