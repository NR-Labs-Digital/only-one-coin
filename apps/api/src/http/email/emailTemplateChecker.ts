import type { EditableEmailKey, EmailTemplateContent, IEmailTemplateChecker } from "@ooc/domain";
import { checkEmailContent, repositoryEmailContent, templateVersion } from "@ooc/notifications";
import { EMAIL_PREVIEW_SAMPLES } from "./emailPreviewSamples.js";

/**
 * The repository's side of an editable e-mail (OOC-60): its words in
 * `packages/notifications`, and the check of edited words over the preview's
 * sample data — the vars every placeholder is checked against are the
 * sample's, which `EmailTemplateVars` types to be the e-mail's own.
 */
export const emailTemplateChecker: IEmailTemplateChecker = {
  repositoryContent: (templateKey: EditableEmailKey) => repositoryEmailContent(templateKey),
  repositoryVersion: (templateKey: EditableEmailKey) => templateVersion(templateKey),
  check: (templateKey: EditableEmailKey, content: EmailTemplateContent) =>
    checkEmailContent(templateKey, content, EMAIL_PREVIEW_SAMPLES[templateKey]),
};
