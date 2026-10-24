import { Readable } from "node:stream";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { RATE_LIMITS } from "@/shared/http/rateLimit.js";
import { container } from "@/container.js";
import type { AuditLogRow } from "@/infra/persistence/audit/AuditLogQuery.js";
import { AuditLogFiltersSchema, serializeAuditLogRow, toAuditLogFilters } from "./auditSchemas.js";
import { AUDIT_LOG_ROLES } from "./auditRoles.js";

async function* ndjsonLines(batches: AsyncGenerator<AuditLogRow[]>): AsyncGenerator<string> {
  for await (const batch of batches) {
    yield batch.map((row) => `${JSON.stringify(serializeAuditLogRow(row))}\n`).join("");
  }
}

// The audit log as data for a file (OOC-122) — the same filters as the
// screen, every page, one row per line (NDJSON) like the student export
// (OOC-121): the column titles and action names are UI text, so apps/app
// writes the CSV in the reader's language. The export is itself an entry
// (`audit_log.exported`), written before the first row.
export const exportAuditLogRoute = RouteBuilder.get("/audit-log/export")
  .docs({
    tags: ["Audit"],
    summary: "Export the audit log as NDJSON",
    description:
      "Every entry the filters match, one JSON row per line. Writes its own audit_log entry before the first row; its own per-account rate limit.",
  })
  .roles(...AUDIT_LOG_ROLES)
  .rateLimit(RATE_LIMITS.staff, RATE_LIMITS.auditExport)
  .query(AuditLogFiltersSchema)
  .response(400, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.queries.auditLog.export(toAuditLogFilters(request.query), request.currentUser!.id);

    return reply
      .status(200)
      .header("content-type", "application/x-ndjson; charset=utf-8")
      .header("cache-control", "no-store")
      .header("x-row-count", String(result.rowCount))
      .send(Readable.from(ndjsonLines(result.batches)));
  });
