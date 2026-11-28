import { isPushEmailKey, type Locale } from "@ooc/domain";
import { TemplateRenderError, renderEmailSummary, type OutgoingEmail } from "@ooc/notifications";
import type {
  IPushOutboxStore,
  IPushSubscriptionStore,
  PushOutcome,
} from "@/infra/persistence/notification/DrizzlePushRepository.js";
import { PushSubscriptionGoneError, type PushSender } from "@/infra/push/WebPushSender.js";
import { wordingFor, type PublishedEmailWording } from "./deliverOutboxEmail.js";

export interface DeliverOutboxPushDeps {
  store: IPushOutboxStore;
  subscriptions: IPushSubscriptionStore;
  sender: PushSender;
  wording: PublishedEmailWording;
  /** The same allowlist the e-mails go through (CLAUDE.md §6): off only in production. */
  allows: (recipient: string) => boolean;
  /** The portal's origin (`PORTAL_PUBLIC_URL`). */
  portalOrigin: string;
  onDeviceFailed?: (info: { outboxId: string; code: string }) => void;
}

/** es-PE has no prefix; the others do (CLAUDE.md §4, roteamento). */
const PORTAL_PATH: Record<Locale, string> = { "es-PE": "/portal", "pt-BR": "/pt/portal", en: "/en/portal" };

/**
 * One outbox row as a push to every device of the recipient's portal account
 * (OOC-51). The words are the e-mail's own — its subject as the title and its
 * preheader as the body, in the row's language and with the wording published
 * in the backoffice — so a push never says something the e-mail does not.
 *
 * At most once, never retried: the row is claimed before anything is sent,
 * and a push lost along the way is not worth a duplicate on the lock screen —
 * the e-mail of the same row is the record. Ends the row as:
 *
 * - `sent` — at least one device took it;
 * - `no_device` — the account has none subscribed (or there is no account);
 * - `blocked` — the recipient is off the allowlist outside production;
 * - `failed` — every device refused it, or the words did not render.
 *
 * A device the push service no longer knows (404/410) is forgotten.
 */
export async function deliverOutboxPush(
  outboxId: string,
  deps: DeliverOutboxPushDeps,
): Promise<PushOutcome | "skipped"> {
  const row = await deps.store.claimPush(outboxId);
  if (!row) return "skipped";

  const finish = async (outcome: PushOutcome) => {
    await deps.store.finishPush(row.id, outcome);
    return outcome;
  };

  if (!isPushEmailKey(row.templateKey)) return finish("failed");
  if (!deps.allows(row.recipient)) return finish("blocked");

  const devices = await deps.subscriptions.listForRecipient(row.recipient);
  if (devices.length === 0) return finish("no_device");

  const email = { to: row.recipient, templateKey: row.templateKey, locale: row.locale, vars: row.vars } as OutgoingEmail;
  let title: string;
  let body: string;
  try {
    const { copy } = await wordingFor(email, row.id, null, deps);
    const rendered = renderEmailSummary(copy ? { ...email, copy } : email);
    title = rendered.subject;
    body = rendered.preheader;
  } catch (error) {
    if (!(error instanceof TemplateRenderError)) throw error;
    return finish("failed");
  }

  const payload = { title, body, url: `${deps.portalOrigin}${PORTAL_PATH[row.locale]}`, tag: row.id };
  let delivered = 0;
  let refused = 0;
  for (const device of devices) {
    try {
      await deps.sender.send(device, payload);
      delivered += 1;
    } catch (error) {
      if (error instanceof PushSubscriptionGoneError) {
        await deps.subscriptions.forgetEndpoint(device.endpoint);
      } else {
        refused += 1;
        const code = (error as { code?: unknown }).code;
        deps.onDeviceFailed?.({ outboxId: row.id, code: typeof code === "string" ? code : "unexpected" });
      }
    }
  }
  // Every device gone (the app uninstalled, permission revoked): nobody is left to tell.
  if (delivered === 0 && refused === 0) return finish("no_device");
  return finish(delivered > 0 ? "sent" : "failed");
}
