import { CLASS_GROUP_DELETE_BLOCKERS, MAX_CLASS_GROUPS_PER_DELETE } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

const DeleteClassGroupsBodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(MAX_CLASS_GROUPS_PER_DELETE),
});

const DeleteClassGroupsResponseSchema = z.object({
  results: z.array(
    z.discriminatedUnion("outcome", [
      z.object({ id: z.string().uuid(), outcome: z.literal("deleted") }),
      z.object({ id: z.string().uuid(), outcome: z.literal("erased"), reason: z.enum(CLASS_GROUP_DELETE_BLOCKERS) }),
      z.object({ id: z.string().uuid(), outcome: z.literal("not_found") }),
    ]),
  ),
});

/**
 * Takes class groups out of the catalog for good — the exception to
 * "Catálogo sai do ar, não some" (CLAUDE.md §1, 23/11/2026). One that never
 * touched a person is deleted for real; one with history is erased: hidden
 * from every catalog screen and never restored, its enrollments and payments
 * untouched. One or many: the list's selection sends many, the class group
 * page one. Each id answers on its own.
 *
 * Same roles that retire a class group (`CATALOG_WRITE_ROLES`): whoever takes
 * one off the catalog can also take back one that should never have been
 * opened.
 */
export const deleteClassGroupsRoute = RouteBuilder.post("/catalog/class-groups/delete")
  .docs({
    tags: ["Catalog"],
    summary: "Delete class groups for good",
    description:
      "Physically deletes each class group with no enrollment, waitlist entry, live checkout hold or copy, with its module runs. One with history is erased instead: retired, hidden from every catalog read and never restored.",
  })
  .can("catalog.retire")
  .body(DeleteClassGroupsBodySchema)
  .response(200, DeleteClassGroupsResponseSchema)
  .response(400, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const results = await container.useCases.catalog.deleteClassGroups.run({
      actorId: request.currentUser!.id,
      ids: request.body.ids,
    });
    reply.status(200).send({ results });
  });
