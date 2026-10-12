import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { container } from "@/container.js";
import { CATALOG_WRITE_ROLES } from "./catalogRoles.js";
import { WeeklySlotSchema } from "./CatalogSchemas.js";

const TeacherOptionSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  languages: z.array(z.string()),
  availability: z.array(WeeklySlotSchema),
  classGroups: z.array(
    z.object({
      id: z.string().uuid(),
      code: z.string(),
      academicPeriodId: z.string().uuid(),
      slots: z.array(WeeklySlotSchema),
    }),
  ),
});

/**
 * The roster as the class group form needs it (OOC-80). Gated by who opens
 * class groups, not by who reads the teacher directory: `enrollment_supervisor`
 * allocates teachers without reaching their files, so no document, contact or
 * contract leaves here — name, languages and schedule only.
 * No rate limit yet (docs/ROADMAP.md Sessão 25).
 */
export const listTeacherOptionsRoute = RouteBuilder.get("/catalog/teacher-options")
  .docs({ tags: ["Catalog"], summary: "Active teachers a class group can be allocated to" })
  .roles(...CATALOG_WRITE_ROLES)
  .response(200, z.object({ items: z.array(TeacherOptionSchema) }))
  .handler(async (_request, reply) => {
    reply.status(200).send({ items: await container.queries.listTeacherOptions.run() });
  });
