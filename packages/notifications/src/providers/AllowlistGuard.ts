import { RecipientNotAllowedError, type NotificationProvider, type OutgoingEmail } from "../NotificationProvider.js";

export interface AllowlistGuardConfig {
  /** Off only in production. Everywhere else every recipient is checked. */
  enforce: boolean;
  /** Exact addresses (`qa@gmail.com`) or whole domains (`@nrlabsdigital.com`). */
  allowlist: readonly string[];
}

/**
 * Templates that, outside production, go to the allowlist instead of being
 * refused when their recipient is not on it. Only the staff second-factor
 * code (OOC-29): without it nobody can sign in to a test environment as an
 * account whose address is not a real inbox — the seeded `admin@admin.com`,
 * a fake staff member — because master/admin/billing cannot skip the code.
 */
const REDIRECTED_OUTSIDE_PRODUCTION: ReadonlySet<OutgoingEmail["templateKey"]> = new Set(["staff_mfa_code"]);

/**
 * "E-mail real disparado de staging" is a forbidden error with a mechanism
 * (CLAUDE.md §6) — this is the mechanism. It wraps whatever provider is in
 * place, so the guard holds no matter which adapter is behind it, and it
 * refuses before anything is rendered or sent.
 *
 * An empty allowlist with `enforce` on sends nothing at all, which is the
 * right default for an environment that forgot to configure one.
 *
 * One exception, which keeps the guarantee: a template in
 * `REDIRECTED_OUTSIDE_PRODUCTION` addressed to someone off the list is sent to
 * every exact address on the list instead (domain entries name no inbox). It
 * still reaches nobody outside the allowlist; it only changes who on it gets
 * the code. No exact address configured → refused like any other.
 */
export class AllowlistGuard implements NotificationProvider {
  private readonly addresses: Set<string>;
  private readonly domains: Set<string>;

  constructor(
    private readonly inner: NotificationProvider,
    private readonly config: AllowlistGuardConfig,
  ) {
    const entries = config.allowlist.map((entry) => entry.trim().toLowerCase()).filter(Boolean);
    this.addresses = new Set(entries.filter((entry) => !entry.startsWith("@")));
    this.domains = new Set(entries.filter((entry) => entry.startsWith("@")).map((entry) => entry.slice(1)));
  }

  allows(recipient: string): boolean {
    if (!this.config.enforce) return true;

    const address = recipient.trim().toLowerCase();
    if (this.addresses.has(address)) return true;

    const at = address.lastIndexOf("@");
    return at > 0 && this.domains.has(address.slice(at + 1));
  }

  async sendEmail(email: OutgoingEmail): Promise<{ providerId: string }> {
    if (this.allows(email.to)) {
      return this.inner.sendEmail(email);
    }
    if (REDIRECTED_OUTSIDE_PRODUCTION.has(email.templateKey) && this.addresses.size > 0) {
      const sent: string[] = [];
      for (const address of this.addresses) {
        const { providerId } = await this.inner.sendEmail({ ...email, to: address });
        sent.push(providerId);
      }
      return { providerId: sent.join(",") };
    }
    throw new RecipientNotAllowedError();
  }
}
