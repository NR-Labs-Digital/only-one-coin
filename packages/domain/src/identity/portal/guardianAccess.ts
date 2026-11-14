import { DEFAULT_LOCALE } from "../../notification/EmailNotification.js";
import { newPortalToken } from "./PortalAccess.js";
import { portalCredentialsEmail } from "./portalEmails.js";
import type { IPortalLinkBuilder, PortalGuardianProvisioning } from "./ports.js";

/**
 * The guardian's half of a provisioning (OOC-147): a token of their own and the
 * same credentials e-mail the student gets, addressed to the guardian's
 * account. Used by the approval and by the backoffice's "send access".
 */
export function guardianProvisioning(links: IPortalLinkBuilder, now: Date): PortalGuardianProvisioning {
  const activation = newPortalToken("activation", now);
  return {
    activation,
    notify: (account, tokenId) => [
      portalCredentialsEmail(account, links.access(activation.token, DEFAULT_LOCALE), tokenId, DEFAULT_LOCALE),
    ],
  };
}
