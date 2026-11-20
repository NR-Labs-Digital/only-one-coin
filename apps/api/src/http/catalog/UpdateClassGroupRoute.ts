import { ClassGroupModuleAmbiguousError, CatalogClassGroupNotFoundError } from "@ooc/domain";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { CLASS_GROUP_WRITE_ROLES } from "./catalogRoles.js";
import { IdParamsSchema, IdResponseSchema, UpdateClassGroupBodySchema, toDate } from "./CatalogSchemas.js";

/**
 * Edits a class group; an explicit null clears a date. The period never
 * changes, and neither do the seats taken.
 *
 * Teacher, module, schedule and Classroom belong to a module run since
 * OOC-156. On a class group of one run they are still accepted here and go to
 * that run — the form edits them as it always did; with more runs they go to
 * `PATCH /catalog/class-groups/:id/modules/:moduleId`. The run is saved first:
 * it is the part most likely to be refused (teacher, module), and the class
 * group's own fields are saved only once it went through.
 * No rate limit yet (docs/ROADMAP.md Sessão 25).
 */
export const updateClassGroupRoute = RouteBuilder.patch("/catalog/class-groups/:id")
  .docs({
    tags: ["Catalog"],
    summary: "Edit a class group",
    description:
      "The class group's own fields. Teacher, module, schedule, Classroom and Meet are its module run's (OOC-156, OOC-159): accepted here only on a class group of one run; with more, 422 catalog.class_group_module_ambiguous — edit the run instead.",
  })
  .roles(...CLASS_GROUP_WRITE_ROLES)
  .params(IdParamsSchema)
  .body(UpdateClassGroupBodySchema)
  .response(200, IdResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { startsOn, endsOn, enrollmentOpensAt, enrollmentClosesAt, teacherId, classroomLinks, meetUrl, module, fullCourse, slots, ...rest } =
      request.body;
    const actorId = request.currentUser!.id;
    const runPatch = Object.fromEntries(
      Object.entries({ teacherId, classroomLinks, meetUrl, module, fullCourse, slots }).filter(([, value]) => value !== undefined),
    );

    if (Object.keys(runPatch).length > 0) {
      const group = await container.repositories.classGroup.findById(request.params.id);
      if (!group || group.isDeleted) throw new CatalogClassGroupNotFoundError();
      if (group.modules.length !== 1) throw new ClassGroupModuleAmbiguousError();
      await container.useCases.catalog.updateClassGroupModule.run({
        actorId,
        classGroupId: group.id,
        classGroupModuleId: group.modules[0]!.id,
        patch: runPatch,
      });
    }

    const patch = {
      ...rest,
      ...(startsOn !== undefined && { startsOn: toDate(startsOn) }),
      ...(endsOn !== undefined && { endsOn: toDate(endsOn) }),
      ...(enrollmentOpensAt !== undefined && { enrollmentOpensAt: toDate(enrollmentOpensAt) }),
      ...(enrollmentClosesAt !== undefined && { enrollmentClosesAt: toDate(enrollmentClosesAt) }),
    };
    if (Object.keys(patch).length > 0) {
      await container.useCases.catalog.updateClassGroup.run({ actorId, id: request.params.id, patch });
    }
    reply.status(200).send({ id: request.params.id });
  });
