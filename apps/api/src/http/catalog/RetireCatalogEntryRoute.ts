import { CatalogEntryKindSchema } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

const RetireCatalogEntryParamsSchema = z.object({
  kind: CatalogEntryKindSchema,
  id: z.string().uuid(),
});

const CatalogEntryStateSchema = z.object({
  kind: CatalogEntryKindSchema,
  id: z.string().uuid(),
  retiredAt: z.string().datetime().nullable(),
  /**
   * How many enrollments were still standing on the entry. Reported so the
   * panel can say what it just took off the air — never a refusal.
   */
  liveEnrollments: z.number().int().nonnegative(),
});

/**
 * Takes a course, plan, class group or academic period off the shelf
 * (CLAUDE.md §6 — `deleted_at`, never a DELETE; migration 0011 makes Postgres
 * refuse the alternative).
 *
 * Same roles that open a class group in the first place (CLAUDE.md §1, "quem
 * abre turma é admin/enrollment_supervisor pelo backoffice"): whoever decides
 * what goes on sale decides what stops. `billing` is not here — it settles
 * money, it does not shape the catalog.
 */
export const retireCatalogEntryRoute = RouteBuilder.post("/catalog/:kind/:id/retire")
  .docs({
    tags: ["Catalog"],
    summary: "Retire a catalog entry",
    description:
      "Marks the entry as retired. Enrollments already made on it are untouched and keep showing in the ledger; the answer says how many were still standing.",
  })
  .roles("master", "admin", "enrollment_supervisor")
  .params(RetireCatalogEntryParamsSchema)
  .response(200, CatalogEntryStateSchema)
  .response(403, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.catalog.retire.run({
      actorId: request.currentUser!.id,
      kind: request.params.kind,
      id: request.params.id,
    });

    reply.status(200).send({
      kind: result.kind,
      id: result.id,
      retiredAt: result.retiredAt.toISOString(),
      liveEnrollments: result.liveEnrollments,
    });
  });
