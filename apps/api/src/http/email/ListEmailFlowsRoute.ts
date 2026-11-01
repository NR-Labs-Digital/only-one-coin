import { EMAIL_CATALOG_KEYS } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { container } from "@/container.js";
import { EMAIL_FLOW_WINDOW_DAYS } from "@/infra/persistence/notification/EmailFlowCountsQuery.js";
import { EMAIL_FLOW_ROLES } from "./emailRoles.js";
import { EmailFlowSchema, emailFlowPayload } from "./emailFlowSchemas.js";

const ListEmailFlowsResponseSchema = z.object({
  windowDays: z.number().int(),
  items: z.array(EmailFlowSchema),
});

// The automatic e-mails' catalog (OOC-88): every entry of the shared catalog
// (OOC-87), in its order, with the outbox counted over the window.
export const listEmailFlowsRoute = RouteBuilder.get("/emails/flows")
  .docs({
    tags: ["Emails"],
    summary: "Every automatic e-mail, with its outbox counts",
    description:
      "The catalog in order, each entry with a version fingerprint of its repository template and the last 30 days of the outbox by status (sent, failed, blocked). Delivered and bounced need the provider's webhook and are not reported.",
  })
  .roles(...EMAIL_FLOW_ROLES)
  .response(200, ListEmailFlowsResponseSchema)
  .handler(async (_request, reply) => {
    const counts = await container.queries.emailFlowCounts.run();
    reply.status(200).send({
      windowDays: EMAIL_FLOW_WINDOW_DAYS,
      items: EMAIL_CATALOG_KEYS.map((key) => emailFlowPayload(key, counts[key])),
    });
  });
