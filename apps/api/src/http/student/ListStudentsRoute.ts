import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import type { StudentListRow } from "@/infra/persistence/student/ListStudentsQuery.js";
import { STUDENT_FILE_ROLES } from "./studentRoles.js";

// The directory's filters (OOC-76), all applied by Postgres. Absent means
// "all". `q` keeps a two-character floor so a keystroke is not a full-table
// ILIKE; `minor` is the literal "true" a URL carries.
const ListStudentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  q: z.string().trim().min(2).max(100).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  minor: z.enum(["true"]).optional(),
  sort: z.enum(["newest", "oldest"]).default("newest"),
});

const StudentStatusSchema = z.enum(["active", "under_review", "inactive"]);

export const StudentListRowSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  nationalIdType: z.enum(["DNI", "CE", "passport"]),
  nationalId: z.string(),
  email: z.string(),
  phone: z.string(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  country: z.string(),
  region: z.string().nullable(),
  city: z.string(),
  createdAt: z.string(),
  isMinor: z.boolean(),
  status: StudentStatusSchema,
  activeCourses: z.number().int(),
  totalEnrollments: z.number().int(),
  lastActivityAt: z.string(),
});

const StudentDirectoryResponseSchema = z.object({
  items: z.array(StudentListRowSchema),
  // Matching every filter, across every page.
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  // Per chip, over the search alone — what choosing each chip would give.
  counts: z.object({
    all: z.number().int(),
    active: z.number().int(),
    inactive: z.number().int(),
    minors: z.number().int(),
  }),
});

export function serializeStudentRow(row: StudentListRow) {
  return {
    ...row,
    birthDate: row.birthDate.toISOString().slice(0, 10),
    createdAt: row.createdAt.toISOString(),
    lastActivityAt: row.lastActivityAt.toISOString(),
  };
}

// The student directory (OOC-76) — management and enrollment supervision
// only, the same audience as the rest of the student file. The pickers have
// their own route (GET /students/search).
export const listStudentsRoute = RouteBuilder.get("/students")
  .docs({
    tags: ["Students"],
    summary: "The student directory",
    description: "Search, status and age filters applied server-side, paged by offset.",
  })
  .roles(...STUDENT_FILE_ROLES)
  .query(ListStudentsQuerySchema)
  .response(200, StudentDirectoryResponseSchema)
  .response(400, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { page, q, status, minor, sort } = request.query;
    const result = await container.queries.listStudents.directory({
      page,
      q,
      status,
      minor: minor === "true",
      sort,
    });

    reply.status(200).send({ ...result, items: result.items.map(serializeStudentRow) });
  });
