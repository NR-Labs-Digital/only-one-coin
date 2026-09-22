import { CatalogEntryKindSchema } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

const RestoreCatalogEntryParamsSchema = z.object({
  kind: CatalogEntryKindSchema,
  id: z.string().uuid(),
});

const CatalogEntryStateSchema = z.object({
  kind: CatalogEntryKindSchema,
  id: z.string().uuid(),
  retiredAt: z.string().datetime().nullable(),
  liveEnrollments: z.number().int().nonnegative(),
});

/**
 * Puts a retired catalog entry back on offer — the counterpart without which a
 * wrong id is unfixable: no DELETE to undo it with (CLAUDE.md §6), no hand-run
 * SQL in production (§7). Same roles as retiring, for the same reason.
 */
export const restoreCatalogEntryRoute = RouteBuilder.post("/catalog/:kind/:id/restore")
  .docs({
    tags: ["Catalog"],
    summary: "Put a retired catalog entry back on offer",
  })
  .roles("master", "admin", "enrollment_supervisor")
  .params(RestoreCatalogEntryParamsSchema)
  .response(200, CatalogEntryStateSchema)
  .response(403, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.catalog.restore.run({
      actorId: request.currentUser!.id,
      kind: request.params.kind,
      id: request.params.id,
    });

    reply.status(200).send({
      kind: result.kind,
      id: result.id,
      retiredAt: result.retiredAt,
      liveEnrollments: result.liveEnrollments,
    });
  });
