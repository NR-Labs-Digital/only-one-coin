import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Whether a webhook call carries the shared secret (OOC-91). Brevo does not
 * sign the body — the only proof of origin it offers is a static token it
 * sends back as `Authorization: Bearer <token>` — so the comparison is the
 * whole gate. Both sides are hashed first: `timingSafeEqual` needs equal
 * lengths, and hashing gives that without leaking the secret's length.
 */
export function webhookTokenMatches(authorization: string | undefined, expected: string): boolean {
  const match = /^Bearer (.+)$/i.exec(authorization ?? "");
  if (!match?.[1]) return false;
  const sent = createHash("sha256").update(match[1]).digest();
  const wanted = createHash("sha256").update(expected).digest();
  return timingSafeEqual(sent, wanted);
}
