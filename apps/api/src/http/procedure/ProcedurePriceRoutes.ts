import { ProcedureKindSchema, type ProcedurePrice } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { SETTINGS_READ_ROLES } from "@/http/platform/settingsRoles.js";

const ProcedurePriceSchema = z.object({
  kind: ProcedureKindSchema,
  amountCents: z.number().int(),
  validFrom: z.string(),
});

const toResponse = (price: ProcedurePrice) => ({
  kind: price.kind,
  amountCents: price.amountCents,
  validFrom: price.validFrom.toISOString(),
});

/** Today's price of each paid procedure. Read by the same people as the
 * settings it replaced (OOC-41, OOC-83). */
export const listProcedurePricesRoute = RouteBuilder.get("/procedure-prices")
  .docs({ tags: ["Platform"], summary: "The price in force of each paid procedure" })
  .roles(...SETTINGS_READ_ROLES)
  .response(200, z.object({ items: z.array(ProcedurePriceSchema) }))
  .handler(async (_request, reply) => {
    const prices = await container.repositories.procedure.currentPrices();
    reply.status(200).send({ items: prices.map(toResponse) });
  });

/** A new price is a new version, in force from now: who writes the settings
 * writes this. Requests already opened keep what they froze. */
export const setProcedurePriceRoute = RouteBuilder.post("/procedure-prices")
  .docs({ tags: ["Platform"], summary: "Set a new price for a paid procedure" })
  .roles("master", "admin")
  .body(z.object({ kind: ProcedureKindSchema, amountCents: z.number().int() }))
  .response(201, ProcedurePriceSchema)
  .response(400, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const price = await container.useCases.procedure.setPrice.run({
      actorId: request.currentUser!.id,
      kind: request.body.kind,
      amountCents: request.body.amountCents,
    });
    reply.status(201).send(toResponse(price));
  });
