import { randomUUID } from "node:crypto";
import { staffMfaCodeEmail } from "@ooc/domain";
import type { TwoFactorCodeSender } from "@/infra/auth/betterAuth.js";
import type { Db } from "@/infra/db/client.js";
import { insertOutboxEmails } from "@/infra/persistence/notification/DrizzleOutboxRepository.js";

/**
 * Hands Better Auth's second-factor code to the outbox — the same road every
 * other e-mail takes (apps/api/CLAUDE.md, "Notificações"), never a provider
 * call on the request path. The relay picks the row up within seconds; the
 * code's `vars.code` is wiped on the row's final transition, like the
 * checkout's verification code.
 *
 * One write and nothing else to commit with it, so no transaction of its own.
 */
export class OutboxTwoFactorCodeSender implements TwoFactorCodeSender {
  constructor(private readonly db: Db) {}

  async send(input: Parameters<TwoFactorCodeSender["send"]>[0]): Promise<void> {
    await insertOutboxEmails(this.db, [
      staffMfaCodeEmail({
        userId: input.userId,
        sendId: randomUUID(),
        to: input.email,
        recipientName: input.name,
        code: input.code,
        locale: input.locale,
      }),
    ]);
  }
}
