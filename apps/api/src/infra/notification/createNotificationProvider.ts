import {
  AllowlistGuard,
  BrevoNotificationProvider,
  LogNotificationProvider,
  ReservedDomainGuard,
  type NotificationProvider,
} from "@ooc/notifications";
import type { FastifyBaseLogger } from "fastify";
import type { Config } from "@/config.js";

/**
 * Brevo when there is a key, a render-and-log stand-in when there is not —
 * and, either way, wrapped in the allowlist guard, which only opens in
 * NODE_ENV=production (CLAUDE.md §6). The guard is not optional and does not
 * depend on which provider is behind it: a non-production environment with a
 * real Brevo key still reaches nobody outside EMAIL_ALLOWLIST.
 *
 * Inside it, in every environment, the reserved-domain guard: an address on
 * `.invalid` (demo students, retired accounts) never reaches the provider.
 *
 * Caveat: the Dockerfile bakes NODE_ENV=production into every image, so a
 * staging machine built from it must override NODE_ENV or the guard is open.
 */
export function createNotificationProvider(config: Config, logger: FastifyBaseLogger): NotificationProvider {
  const provider: NotificationProvider =
    config.BREVO_API_KEY && config.EMAIL_SENDER_ADDRESS
      ? new BrevoNotificationProvider({
          apiKey: config.BREVO_API_KEY,
          sender: { email: config.EMAIL_SENDER_ADDRESS, name: config.EMAIL_SENDER_NAME },
        })
      : new LogNotificationProvider(logger);

  return new AllowlistGuard(new ReservedDomainGuard(provider), {
    enforce: config.NODE_ENV !== "production",
    allowlist: config.EMAIL_ALLOWLIST,
  });
}
