import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { container } from "@/container.js";
import { serializeTeachingClassGroup, TeachingClassGroupSchema } from "./teachingSchemas.js";

// The teacher's class groups, scoped by the session's account in the usecase
// (CLAUDE.md §8). Coordination reads class groups through /catalog, which a
// teacher never reaches.
export const listOwnClassGroupsRoute = RouteBuilder.get("/teaching/class-groups")
  .docs({
    tags: ["Teaching"],
    summary: "The signed-in teacher's class groups",
    description: "Enrolling, running and finished — closed, draft and retired ones are out of the docente portal.",
  })
  .roles("teacher")
  .response(200, z.object({ items: z.array(TeachingClassGroupSchema) }))
  .handler(async (request, reply) => {
    const groups = await container.useCases.teaching.listOwnClassGroups.run({ userId: request.currentUser!.id });
    reply.status(200).send({ items: groups.map(serializeTeachingClassGroup) });
  });
