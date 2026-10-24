import { AUDIT_ACTION_KEYS, AUDIT_ENTITIES, AUDIT_FIELD_KEYS } from "@ooc/domain";
import { z } from "zod";
import type { AuditLogFilters, AuditLogRow } from "@/infra/persistence/audit/AuditLogQuery.js";

/** A real calendar day — `2026-02-30` would reach Postgres and fail there. */
const CalendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((day) => {
    const parsed = new Date(`${day}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
  });

const ActionKeySchema = z.enum(AUDIT_ACTION_KEYS as [string, ...string[]]);

// The log's filters, shared by the screen and the export. Absent means "all".
export const AuditLogFiltersSchema = z
  .object({
    from: CalendarDaySchema.optional(),
    to: CalendarDaySchema.optional(),
    actorId: z.string().trim().min(1).max(100).optional(),
    action: ActionKeySchema.optional(),
    entity: z.enum(AUDIT_ENTITIES).optional(),
  })
  .refine((filters) => !filters.from || !filters.to || filters.from <= filters.to, { path: ["to"] });

export const AuditLogRowSchema = z.object({
  id: z.string(),
  at: z.string(),
  action: z.union([ActionKeySchema, z.literal("unknown")]),
  entity: z.enum(AUDIT_ENTITIES).nullable(),
  subject: z
    .object({ entity: z.enum(AUDIT_ENTITIES), id: z.string(), label: z.string() })
    .nullable(),
  fields: z.array(z.enum(AUDIT_FIELD_KEYS as [string, ...string[]])),
  actor: z.object({ id: z.string(), name: z.string().nullable(), role: z.string().nullable() }).nullable(),
});

export function toAuditLogFilters(query: z.infer<typeof AuditLogFiltersSchema>): AuditLogFilters {
  return {
    from: query.from,
    to: query.to,
    actorId: query.actorId,
    action: query.action as AuditLogFilters["action"],
    entity: query.entity,
  };
}

export function serializeAuditLogRow(row: AuditLogRow) {
  return { ...row, at: row.at.toISOString() };
}
