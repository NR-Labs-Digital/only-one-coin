import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { CATALOG_OWNER_ROLES, CATALOG_READ_ROLES } from "./catalogRoles.js";
import { IdParamsSchema, IdResponseSchema } from "./CatalogSchemas.js";

/**
 * The language list (OOC-128). Read by everyone who reads the catalog — the
 * teacher file's chips are among them — and changed by whoever opens a
 * course, the same people who set a course's language. No rate limit yet
 * (docs/ROADMAP.md Sessão 25).
 */
const LanguageNameSchema = z.object({ name: z.string().trim().min(1).max(60) });

export const listLanguagesRoute = RouteBuilder.get("/catalog/languages")
  .docs({ tags: ["Catalog"], summary: "List the live languages, with their course and teacher counts" })
  .roles(...CATALOG_READ_ROLES)
  .response(
    200,
    z.object({
      items: z.array(
        z.object({
          id: z.string().uuid(),
          name: z.string(),
          courseCount: z.number().int(),
          teacherCount: z.number().int(),
        }),
      ),
    }),
  )
  .handler(async (_request, reply) => {
    reply.status(200).send({ items: await container.queries.listLanguages.run() });
  });

export const createLanguageRoute = RouteBuilder.post("/catalog/languages")
  .docs({ tags: ["Catalog"], summary: "Create a language" })
  .roles(...CATALOG_OWNER_ROLES)
  .body(LanguageNameSchema)
  .response(201, IdResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const language = await container.useCases.catalog.createLanguage.run({
      actorId: request.currentUser!.id,
      name: request.body.name,
    });
    reply.status(201).send({ id: language.id });
  });

export const renameLanguageRoute = RouteBuilder.patch("/catalog/languages/:id")
  .docs({
    tags: ["Catalog"],
    summary: "Rename a language",
    description: "The new name reaches every course and teacher filed under it.",
  })
  .roles(...CATALOG_OWNER_ROLES)
  .params(IdParamsSchema)
  .body(LanguageNameSchema)
  .response(200, IdResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const language = await container.useCases.catalog.renameLanguage.run({
      actorId: request.currentUser!.id,
      id: request.params.id,
      name: request.body.name,
    });
    reply.status(200).send({ id: language.id });
  });

export const retireLanguageRoute = RouteBuilder.post("/catalog/languages/:id/retire")
  .docs({
    tags: ["Catalog"],
    summary: "Take a language off the list",
    description: "Refused (409 catalog.language_in_use) while a live course is filed under it.",
  })
  .roles(...CATALOG_OWNER_ROLES)
  .params(IdParamsSchema)
  .response(200, z.object({ teachersReleased: z.number().int() }))
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.catalog.retireLanguage.run({
      actorId: request.currentUser!.id,
      id: request.params.id,
    });
    reply.status(200).send(result);
  });
