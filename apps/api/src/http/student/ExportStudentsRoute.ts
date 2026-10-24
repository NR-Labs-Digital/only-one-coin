import { Readable } from "node:stream";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { RATE_LIMITS } from "@/shared/http/rateLimit.js";
import { container } from "@/container.js";
import type { StudentListRow } from "@/infra/persistence/student/ListStudentsQuery.js";
import { ListStudentsQuerySchema, serializeStudentRow } from "./ListStudentsRoute.js";
import { STUDENT_EXPORT_ROLES } from "./studentRoles.js";

// The directory's own filters, every page at once — the tab, search and age
// chip the screen shows (OOC-121).
const ExportStudentsQuerySchema = ListStudentsQuerySchema.omit({ page: true });

async function* ndjsonLines(batches: AsyncGenerator<StudentListRow[]>): AsyncGenerator<string> {
  for await (const batch of batches) {
    yield batch.map((row) => `${JSON.stringify(serializeStudentRow(row))}\n`).join("");
  }
}

// The student directory as data for a file (OOC-121). One directory row per
// line (NDJSON) — the same shape as `GET /students` — and no column titles:
// those are UI text, so apps/app writes the CSV in the reader's language.
// Streamed batch by batch; `x-row-count` is what the audit entry recorded.
export const exportStudentsRoute = RouteBuilder.get("/students/export")
  .docs({
    tags: ["Students"],
    summary: "Export the student directory as NDJSON",
    description:
      "Every student the directory's tab, search and age filter match, one JSON row per line. Writes audit_log before the first row; its own per-account rate limit.",
  })
  .roles(...STUDENT_EXPORT_ROLES)
  .rateLimit(RATE_LIMITS.staff, RATE_LIMITS.studentExport)
  .query(ExportStudentsQuerySchema)
  .response(400, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { q, status, minor, sort } = request.query;
    const result = await container.queries.listStudents.exportDirectory(
      { q, status: status === "all" ? undefined : status, minor: minor === "true", sort },
      request.currentUser!.id,
    );

    return reply
      .status(200)
      .header("content-type", "application/x-ndjson; charset=utf-8")
      .header("cache-control", "no-store")
      .header("x-row-count", String(result.rowCount))
      .send(Readable.from(ndjsonLines(result.batches)));
  });
