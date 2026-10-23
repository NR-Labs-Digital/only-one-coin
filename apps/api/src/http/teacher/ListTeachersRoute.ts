import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { TEACHER_READ_ROLES } from "./teacherRoles.js";
import { serializeTeacherRow, TeacherRowResponseSchema } from "./teacherSchemas.js";

// Every filter runs in Postgres (OOC-78). `free` and `contract` are the
// literal "true" a URL carries, and only narrow the roster tab.
const ListTeachersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  status: z.enum(["active", "inactive"]).default("active"),
  q: z.string().trim().min(2).max(100).optional(),
  language: z.string().trim().min(1).max(100).optional(),
  free: z.enum(["true"]).optional(),
  contract: z.enum(["true"]).optional(),
});

const TeacherDirectoryResponseSchema = z.object({
  items: z.array(TeacherRowResponseSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  counts: z.object({
    active: z.number().int(),
    inactive: z.number().int(),
    free: z.number().int(),
    contract: z.number().int(),
  }),
  contractAlertDays: z.number().int(),
});

export const listTeachersRoute = RouteBuilder.get("/teachers")
  .docs({
    tags: ["Teachers"],
    summary: "The teacher roster",
    description: "Roster or former teachers, with search, language, free and contract filters applied server-side.",
  })
  .roles(...TEACHER_READ_ROLES)
  .query(ListTeachersQuerySchema)
  .response(200, TeacherDirectoryResponseSchema)
  .response(400, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { page, status, q, language, free, contract } = request.query;
    const result = await container.queries.listTeachers.directory({
      page,
      status,
      q,
      language,
      free: free === "true",
      contract: contract === "true",
    });

    reply.status(200).send({ ...result, items: result.items.map(serializeTeacherRow) });
  });
