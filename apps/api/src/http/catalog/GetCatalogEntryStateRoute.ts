import { CatalogEntryKindSchema } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

const CatalogEntryParamsSchema = z.object({
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
 * How many enrollments a catalog entry still carries, read before retiring it
 * so the confirmation can say so (OOC-70, CLAUDE.md §1 "avisa, não bloqueia").
 *
 * Same roles as retire and restore: the count is part of that decision, and
 * nobody else is offered the button.
 */
export const getCatalogEntryStateRoute = RouteBuilder.get("/catalog/:kind/:id/state")
  .docs({
    tags: ["Catalog"],
    summary: "Where a catalog entry stands (retired, live enrollments)",
  })
  .roles("master", "admin", "enrollment_supervisor")
  .params(CatalogEntryParamsSchema)
  .response(200, CatalogEntryStateSchema)
  .response(403, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const state = await container.useCases.catalog.getState.run({
      kind: request.params.kind,
      id: request.params.id,
    });

    reply.status(200).send({
      kind: state.kind,
      id: state.id,
      retiredAt: state.retiredAt?.toISOString() ?? null,
      liveEnrollments: state.liveEnrollments,
    });
  });
