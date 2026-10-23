import { z } from "zod";
import { CatalogClassGroupNotFoundError, type Role } from "@ooc/domain";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import type { ClassGroupRosterRow } from "@/infra/persistence/catalog/ClassGroupRosterQuery.js";
import { STUDENT_FILE_ROLES } from "@/http/student/studentRoles.js";
import { CATALOG_READ_ROLES } from "./catalogRoles.js";
import { IdParamsSchema } from "./CatalogSchemas.js";

const RosterItemSchema = z.object({
  enrollmentId: z.string().uuid(),
  studentId: z.string().uuid(),
  studentName: z.string(),
  planName: z.string(),
  paymentStatus: z.enum(["pending", "under_review", "approved", "rejected"]).nullable(),
  // The national id and the contact, only for who reads the student file.
  file: z
    .object({
      nationalIdType: z.enum(["DNI", "CE", "passport"]),
      nationalId: z.string(),
      email: z.string(),
      phone: z.string(),
    })
    .nullable(),
});

const RosterResponseSchema = z.object({
  // Which columns this reader gets, so the screen draws them without
  // second-guessing the role: "full" carries `file` on every row.
  view: z.enum(["full", "limited"]),
  items: z.array(RosterItemSchema),
});

/**
 * The columns per role. The national id and the contact go only to who reads
 * and corrects the student file (`STUDENT_FILE_ROLES`, the GET /students and
 * waitlist rule); every other catalog reader gets what the enrollment ledger
 * already shows them — name, plan, payment status. Nothing about the guardian
 * leaves this route, for anyone.
 */
export function shapeRoster(role: Role, rows: ClassGroupRosterRow[]): z.infer<typeof RosterResponseSchema> {
  const full = (STUDENT_FILE_ROLES as readonly Role[]).includes(role);
  return {
    view: full ? "full" : "limited",
    items: rows.map((row) => ({
      enrollmentId: row.enrollmentId,
      studentId: row.studentId,
      studentName: `${row.firstName} ${row.lastName}`,
      planName: row.planName,
      paymentStatus: row.paymentStatus,
      file: full
        ? {
            nationalIdType: row.nationalIdType as "DNI" | "CE" | "passport",
            nationalId: row.nationalId,
            email: row.email,
            phone: row.phone,
          }
        : null,
    })),
  };
}

// Who is enrolled in a class group — the base the teacher view, grades,
// procedures and the certificate batch build on. A teacher is not a catalog
// reader: their roster is `/teaching/class-groups/:id/students` (OOC-82),
// names only, checked against the session's teacher — never this route.
// No rate limit yet (docs/ROADMAP.md Sessão 25).
export const getClassGroupRosterRoute = RouteBuilder.get("/catalog/class-groups/:id/roster")
  .docs({
    tags: ["Catalog"],
    summary: "Who is enrolled in a class group",
    description:
      "Confirmed seats only, ordered by surname. National id and contact only for master, admin and enrollment_supervisor; never guardian data.",
  })
  .roles(...CATALOG_READ_ROLES)
  .params(IdParamsSchema)
  .response(200, RosterResponseSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const rows = await container.queries.classGroupRoster.run(request.params.id);
    if (!rows) throw new CatalogClassGroupNotFoundError();
    reply.status(200).send(shapeRoster(request.currentUser!.role, rows));
  });
