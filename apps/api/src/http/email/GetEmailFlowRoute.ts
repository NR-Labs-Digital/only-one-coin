import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { EMAIL_FLOW_WINDOW_DAYS } from "@/infra/persistence/notification/EmailFlowCountsQuery.js";
import { EMAIL_FLOW_ROLES } from "./emailRoles.js";
import { EmailFlowKeySchema, EmailFlowSchema, emailFlowPayload } from "./emailFlowSchemas.js";

// One automatic e-mail (OOC-88). The key is the catalog's closed list, so a
// key that names nothing is refused by the schema before the handler runs.
export const getEmailFlowRoute = RouteBuilder.get("/emails/flows/:key")
  .docs({ tags: ["Emails"], summary: "One automatic e-mail, with its outbox counts" })
  .roles(...EMAIL_FLOW_ROLES)
  .params(z.object({ key: EmailFlowKeySchema }))
  .response(200, z.object({ windowDays: z.number().int(), flow: EmailFlowSchema }))
  .response(400, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const counts = await container.queries.emailFlowCounts.run();
    reply.status(200).send({
      windowDays: EMAIL_FLOW_WINDOW_DAYS,
      flow: emailFlowPayload(request.params.key, counts[request.params.key]),
    });
  });
