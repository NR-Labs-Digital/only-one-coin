import { RecipientNotAllowedError, type NotificationProvider, type OutgoingEmail } from "../NotificationProvider.js";

/**
 * Refuses, in every environment, an address on the reserved `.invalid`
 * top-level domain (RFC 2606) — one that can never be delivered, written on
 * purpose: the fictitious students of a demo class group (`@demo.invalid`,
 * apps/api CLAUDE.md "Contas demo") and the marker a retired account's e-mail
 * is swapped for (`@retired.invalid`). Refused like an address off the
 * allowlist: the outbox marks it blocked, without retry, and nothing reaches
 * the provider.
 */
export class ReservedDomainGuard implements NotificationProvider {
  constructor(private readonly inner: NotificationProvider) {}

  static undeliverable(recipient: string): boolean {
    return /\.invalid$/i.test(recipient.trim());
  }

  async sendEmail(email: OutgoingEmail): Promise<{ providerId: string }> {
    if (ReservedDomainGuard.undeliverable(email.to)) throw new RecipientNotAllowedError();
    return this.inner.sendEmail(email);
  }
}
