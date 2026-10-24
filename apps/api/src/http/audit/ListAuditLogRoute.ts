import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { AuditLogFiltersSchema, AuditLogRowSchema, serializeAuditLogRow, toAuditLogFilters } from "./auditSchemas.js";
import { AUDIT_LOG_ROLES } from "./auditRoles.js";

const ListAuditLogQuerySchema = AuditLogFiltersSchema.and(z.object({ cursor: z.string().max(200).optional() }));

const ListAuditLogResponseSchema = z.object({
  items: z.array(AuditLogRowSchema),
  nextCursor: z.string().nullable(),
});

// The general audit log (OOC-122). Reads audit_log, never edits it — the
// database refuses that anyway (migration 0011).
export const listAuditLogRoute = RouteBuilder.get("/audit-log")
  .docs({
    tags: ["Audit"],
    summary: "The general audit log",
    description:
      "Every entry newest first, 50 a page by an opaque cursor. Filters by period (Lima calendar days), author, action and entity, all in Postgres.",
  })
  .roles(...AUDIT_LOG_ROLES)
  .query(ListAuditLogQuerySchema)
  .response(200, ListAuditLogResponseSchema)
  .response(400, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const page = await container.queries.auditLog.page(toAuditLogFilters(request.query), request.query.cursor);

    reply.status(200).send({ items: page.items.map(serializeAuditLogRow), nextCursor: page.nextCursor });
  });
