import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { container } from "@/container.js";
import { AUDIT_LOG_ROLES } from "./auditRoles.js";

const ListAuditActorsResponseSchema = z.object({
  items: z.array(z.object({ id: z.string(), name: z.string(), role: z.string() })),
});

// The log's author filter: every panel account, removed ones included — the
// log outlives the account. Students write entries too (setting their portal
// password) but are 30k and are found through their file instead.
export const listAuditActorsRoute = RouteBuilder.get("/audit-log/actors")
  .docs({
    tags: ["Audit"],
    summary: "Panel accounts, for the audit log's author filter",
  })
  .roles(...AUDIT_LOG_ROLES)
  .response(200, ListAuditActorsResponseSchema)
  .handler(async (_request, reply) => {
    reply.status(200).send({ items: await container.queries.auditLog.actors() });
  });
