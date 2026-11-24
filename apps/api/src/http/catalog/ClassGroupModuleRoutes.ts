import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import {
  ClassGroupModuleParamsSchema,
  CreateClassGroupModuleBodySchema,
  IdParamsSchema,
  IdResponseSchema,
  UpdateClassGroupModuleBodySchema,
} from "./CatalogSchemas.js";

/**
 * The module runs of a class group — the "sub-turmas" (OOC-156). The same
 * people who edit a class group open, edit and retire its runs.
 * No rate limit of their own: they sit behind a staff session, which carries
 * the per-user budget (OOC-24).
 */

export const addClassGroupModuleRoute = RouteBuilder.post("/catalog/class-groups/:id/modules")
  .docs({
    tags: ["Catalog"],
    summary: "Open another module run of a class group (OOC-156)",
    description:
      "One run per module of the course. A full-course run, or one with no module set, is alone in its class group (422 catalog.class_group_module_alone). 422 catalog.class_group_module_taken when that module already runs.",
  })
  .can("catalog.class_groups_edit")
  .params(IdParamsSchema)
  .body(CreateClassGroupModuleBodySchema)
  .response(201, IdResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const run = await container.useCases.catalog.addClassGroupModule.run({
      actorId: request.currentUser!.id,
      classGroupId: request.params.id,
      module: request.body,
    });
    reply.status(201).send({ id: run.id });
  });

export const updateClassGroupModuleRoute = RouteBuilder.patch("/catalog/class-groups/:id/modules/:moduleId")
  .docs({ tags: ["Catalog"], summary: "Edit a module run's teacher, module, schedule or Classroom (OOC-156)" })
  .can("catalog.class_groups_edit")
  .params(ClassGroupModuleParamsSchema)
  .body(UpdateClassGroupModuleBodySchema)
  .response(200, IdResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const run = await container.useCases.catalog.updateClassGroupModule.run({
      actorId: request.currentUser!.id,
      classGroupId: request.params.id,
      classGroupModuleId: request.params.moduleId,
      patch: request.body,
    });
    reply.status(200).send({ id: run.id });
  });

export const retireClassGroupModuleRoute = RouteBuilder.post("/catalog/class-groups/:id/modules/:moduleId/retire")
  .docs({
    tags: ["Catalog"],
    summary: "Retire a module run (OOC-156)",
    description:
      "Never the class group's last run (422 catalog.class_group_module_last) nor one a live seat is in (422 catalog.class_group_module_has_students).",
  })
  .can("catalog.class_groups_edit")
  .params(ClassGroupModuleParamsSchema)
  .response(204, z.void())
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    await container.useCases.catalog.retireClassGroupModule.run({
      actorId: request.currentUser!.id,
      classGroupId: request.params.id,
      classGroupModuleId: request.params.moduleId,
    });
    reply.status(204).send();
  });
