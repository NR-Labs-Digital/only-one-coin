import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { TEACHER_EDIT_ROLES } from "./teacherRoles.js";
import { TeacherParamsSchema } from "./teacherSchemas.js";

/** `YYYY-MM-DD` that is a real day — `2026-02-30` would roll over to March in a Date. */
const CalendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  });

/**
 * The teacher contract, filled from the teacher file and the published
 * template (OOC-123), as a PDF download. Generating it records the contract
 * period (OOC-124) — the row the roster's alert watches — while the PDF itself
 * is never stored: the signed copy is kept outside the platform (decision of
 * 23/10/2026). Who may generate it is who corrects the file — the analyst
 * reads, never issues.
 */
export const generateTeacherContractRoute = RouteBuilder.post("/teachers/:teacherId/contract-document")
  .docs({
    tags: ["Teachers"],
    summary: "Generate the teacher contract: record its period and download the PDF",
    description:
      "Fills the published contract template with the teacher file and the given period, records the contract (period, template version, who generated it) and responds with the PDF itself (application/pdf). Writes audit_log.",
  })
  .roles(...TEACHER_EDIT_ROLES)
  .params(TeacherParamsSchema)
  .body(z.object({ startsOn: CalendarDaySchema, endsOn: CalendarDaySchema }))
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .response(503, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { pdf, contractId, templateVersion } = await container.documents.teacherContract.generate({
      actorId: request.currentUser!.id,
      teacherId: request.params.teacherId,
      startsOn: request.body.startsOn,
      endsOn: request.body.endsOn,
    });
    reply
      .status(200)
      .header("Content-Type", "application/pdf")
      .header("Cache-Control", "no-store")
      .header("X-Template-Version", String(templateVersion))
      .header("X-Contract-Id", contractId)
      .send(Buffer.from(pdf));
  });
