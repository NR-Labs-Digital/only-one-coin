import {
  EMAIL_AUDIENCES,
  EMAIL_CATALOG,
  EMAIL_CATALOG_KEYS,
  EMAIL_STAGES,
  EMAIL_TEMPLATE_KEYS,
  type EmailCatalogKey,
  type EmailTemplateKey,
} from "@ooc/domain";
import { templateVersion } from "@ooc/notifications";
import { z } from "zod";
import type { EmailFlowCounts } from "@/infra/persistence/notification/EmailFlowCountsQuery.js";

export const EmailFlowKeySchema = z.enum(EMAIL_CATALOG_KEYS as [EmailCatalogKey, ...EmailCatalogKey[]]);

/** Only an emitted template has words in the repository to render. */
export const EmittedEmailKeySchema = z.enum(EMAIL_TEMPLATE_KEYS as [EmailTemplateKey, ...EmailTemplateKey[]]);

export const EmailFlowSchema = z.object({
  key: EmailFlowKeySchema,
  audience: z.enum(EMAIL_AUDIENCES),
  stage: z.enum(EMAIL_STAGES).nullable(),
  conditional: z.boolean(),
  emitted: z.boolean(),
  /** Fingerprint of the template's words (`templateVersion`); null when nothing sends it yet. */
  version: z.string().nullable(),
  counts: z.object({ sent: z.number().int(), failed: z.number().int(), blocked: z.number().int() }),
});

export type EmailFlowPayload = z.infer<typeof EmailFlowSchema>;

function isEmitted(key: EmailCatalogKey): key is EmailTemplateKey {
  return EMAIL_CATALOG[key].emitted;
}

/** One catalog entry with what the repository and the outbox say about it. */
export function emailFlowPayload(key: EmailCatalogKey, counts: EmailFlowCounts): EmailFlowPayload {
  return {
    key,
    ...EMAIL_CATALOG[key],
    version: isEmitted(key) ? templateVersion(key) : null,
    counts,
  };
}
