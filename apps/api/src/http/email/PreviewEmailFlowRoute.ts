import { DEFAULT_LOCALE, EMAIL_CATALOG, LocaleSchema } from "@ooc/domain";
import { renderEmail, templateVersion, type OutgoingEmail } from "@ooc/notifications";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { EMAIL_FLOW_ROLES } from "./emailRoles.js";
import { EmittedEmailKeySchema } from "./emailFlowSchemas.js";
import { EMAIL_PREVIEW_RECIPIENTS, EMAIL_PREVIEW_SAMPLES } from "./emailPreviewSamples.js";

const PreviewEmailFlowResponseSchema = z.object({
  locale: LocaleSchema,
  version: z.string(),
  to: z.string(),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
});

// The template as the student receives it (OOC-88, ROADMAP 47): the same
// `renderEmail` the send-email worker runs, over invented sample data — never
// a copy written for the screen, never a real student. A template nothing
// sends yet has no words in the repository, so only emitted keys pass.
export const previewEmailFlowRoute = RouteBuilder.get("/emails/flows/:key/preview")
  .docs({
    tags: ["Emails"],
    summary: "Render an automatic e-mail's repository template over sample data",
  })
  .roles(...EMAIL_FLOW_ROLES)
  .params(z.object({ key: EmittedEmailKeySchema }))
  .query(z.object({ locale: LocaleSchema.default(DEFAULT_LOCALE) }))
  .response(200, PreviewEmailFlowResponseSchema)
  .response(400, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { key } = request.params;
    const { locale } = request.query;
    const to = EMAIL_PREVIEW_RECIPIENTS[EMAIL_CATALOG[key].audience];
    const email = { to, templateKey: key, locale, vars: EMAIL_PREVIEW_SAMPLES[key] } as OutgoingEmail;
    const rendered = renderEmail(email);

    reply.status(200).send({ locale, version: templateVersion(key), to, ...rendered });
  });
