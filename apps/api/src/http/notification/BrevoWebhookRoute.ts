import { parseBrevoEvent } from "@ooc/notifications";
import { z } from "zod";
import { container } from "@/container.js";
import { webhookTokenMatches } from "@/infra/edge/BrevoWebhookAuth.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { RATE_LIMITS } from "@/shared/http/rateLimit.js";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";

/**
 * What Brevo reports after taking a message — delivered, bounced, blocked,
 * unsubscribed (OOC-91). Public by necessity: Brevo has no session. The gate
 * is the shared bearer token; without `BREVO_WEBHOOK_TOKEN` configured the
 * route refuses everything — closed, never open.
 *
 * Answers 200 for every authenticated call that is well-formed, including
 * events we do not record and messages we do not know: a non-2xx makes Brevo
 * retry, and a retry cannot make an event we chose to ignore interesting.
 * Logs carry the outcome, never the address or the provider's reason text.
 */
export const brevoWebhookRoute = RouteBuilder.post("/webhooks/brevo")
  .docs({ tags: ["Notifications"], summary: "Brevo transactional webhook: delivery and bounce events" })
  .public()
  .rateLimit(RATE_LIMITS.brevoWebhook)
  .body(z.record(z.unknown()))
  .response(200, z.object({}))
  .response(400, ErrorResponseSchema)
  .response(401, ErrorResponseSchema)
  .response(503, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const expected = container.config.BREVO_WEBHOOK_TOKEN;
    if (!expected) {
      return reply.status(503).send({ status: 503, reason: "webhook.unavailable", path: request.url });
    }
    if (!webhookTokenMatches(request.headers.authorization, expected)) {
      request.log.warn("brevo webhook refused: missing or invalid token");
      return reply.status(401).send({ status: 401, reason: "webhook.unauthorized", path: request.url });
    }

    const parsed = parseBrevoEvent(request.body);
    if (!parsed) {
      return reply.status(400).send({ status: 400, reason: "webhook.invalid_payload", path: request.url });
    }
    if (parsed.kind === "ignored") {
      return reply.status(200).send({});
    }

    const outcome = await container.notifications.delivery.record(parsed.event);
    request.log.info({ kind: parsed.event.kind, outcome: outcome.kind }, "brevo delivery event handled");
    return reply.status(200).send({});
  });
