import { isAllowedPushEndpoint, UnableToProcessEntryError } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

/*
 * Push notifications on the portal (OOC-51): the account turns them on and
 * off for the device it is on. The account is always the session's — the body
 * names a device, never an account (CLAUDE.md §8, anti-IDOR).
 *
 * No usecase and no audit entry, like the preferred language: it is a choice
 * the person makes about their own device, and the browser's own permission
 * prompt is the opt-in. The one rule — which push services the API will ever
 * call — is the domain's `isAllowedPushEndpoint`.
 */

/** What `PushSubscription.toJSON()` gives the browser, sized well above real values. */
const SubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(128),
  }),
});

export const getPortalPushRoute = RouteBuilder.get("/portal/push")
  .docs({
    tags: ["Portal"],
    summary: "Whether push notifications are on, and the key to subscribe with",
    description: "publicKey is null when the platform has no VAPID keys: the portal then does not offer push.",
  })
  .roles("student")
  .response(200, z.object({ publicKey: z.string().nullable() }))
  .handler(async (_request, reply) => {
    reply.status(200).send({ publicKey: container.notifications.push.publicKey });
  });

export const subscribePortalPushRoute = RouteBuilder.put("/portal/push/subscription")
  .docs({
    tags: ["Portal"],
    summary: "Turn push notifications on for this device",
    description:
      "Saves the browser's push subscription on the signed-in account. The same browser subscribing again takes the row over.",
  })
  .roles("student")
  .body(SubscriptionSchema)
  .response(204, z.null())
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    if (!container.notifications.push.publicKey) {
      throw new UnableToProcessEntryError({ reason: "push.unavailable", message: "Push notifications are not offered." });
    }
    if (!isAllowedPushEndpoint(request.body.endpoint)) {
      throw new UnableToProcessEntryError({
        reason: "push.endpoint_not_allowed",
        message: "The subscription does not point to a known push service.",
      });
    }
    await container.notifications.push.repository.subscribe(request.currentUser!.id, {
      endpoint: request.body.endpoint,
      p256dh: request.body.keys.p256dh,
      auth: request.body.keys.auth,
    });
    reply.status(204).send();
  });

export const unsubscribePortalPushRoute = RouteBuilder.delete("/portal/push/subscription")
  .docs({
    tags: ["Portal"],
    summary: "Turn push notifications off for this device",
    description: "Forgets the device on the signed-in account. A device of another account, or none, is a no-op.",
  })
  .roles("student")
  .body(z.object({ endpoint: z.string().max(2048) }))
  .response(204, z.null())
  .handler(async (request, reply) => {
    await container.notifications.push.repository.unsubscribe(request.currentUser!.id, request.body.endpoint);
    reply.status(204).send();
  });
