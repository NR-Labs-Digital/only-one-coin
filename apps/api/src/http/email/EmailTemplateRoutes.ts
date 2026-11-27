import {
  EDITABLE_EMAIL_KEYS,
  EMAIL_CATALOG,
  LocaleSchema,
  type EditableEmailKey,
  type EmailTemplateVersion,
} from "@ooc/domain";
import { emailPlaceholders, renderEmail, type OutgoingEmail } from "@ooc/notifications";
import { z } from "zod";
import { container } from "@/container.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { EMAIL_PREVIEW_RECIPIENTS, EMAIL_PREVIEW_SAMPLES } from "./emailPreviewSamples.js";
import { emailTemplateChecker } from "./emailTemplateChecker.js";

/*
 * Editable e-mail wording (OOC-60): read, save the draft, preview words over
 * the sample data, publish. The key is the closed list of editable templates,
 * so a staff e-mail or a security one is refused by the schema.
 */

const EditableEmailKeySchema = z.enum(EDITABLE_EMAIL_KEYS as [EditableEmailKey, ...EditableEmailKey[]]);
const ParamsSchema = z.object({ key: EditableEmailKeySchema });

// Generous ceilings — an e-mail, not a document — that stop a paste of a
// book, never a real paragraph.
const Text = z.string().max(2000);
const EmailCopySchema = z
  .object({
    subject: z.string().max(200),
    preheader: z.string().max(300),
    paragraphs: z.array(Text).max(30),
    action: z.string().max(80).optional(),
    item: z.string().max(500).optional(),
    values: z.record(z.string().max(60), z.record(z.string().max(60), z.string().max(120))).optional(),
    missing: z.string().max(120).optional(),
  })
  .strict();

const ContentSchema = z
  .object(Object.fromEntries(LocaleSchema.options.map((locale) => [locale, EmailCopySchema.optional()])) as {
    [K in z.infer<typeof LocaleSchema>]: z.ZodOptional<typeof EmailCopySchema>;
  })
  .strict();

const IssueSchema = z.object({
  code: z.string(),
  locale: LocaleSchema.optional(),
  field: z.string().optional(),
  index: z.number().int().optional(),
  placeholder: z.string().optional(),
});

const VersionSchema = z.object({
  id: z.string(),
  version: z.number().int(),
  content: ContentSchema,
  publishedAt: z.string(),
  publishedByName: z.string().nullable(),
  /** The repository's words changed in the code after this was published. */
  repositoryChanged: z.boolean(),
});

const DraftSchema = z.object({
  content: ContentSchema,
  updatedAt: z.string(),
  issues: z.array(IssueSchema),
  warnings: z.array(IssueSchema),
});

function versionPayload(version: EmailTemplateVersion, repositoryVersion: string) {
  return {
    id: version.id,
    version: version.version,
    content: version.content,
    publishedAt: version.createdAt.toISOString(),
    publishedByName: version.publishedByName,
    repositoryChanged: version.repositoryVersion !== repositoryVersion,
  };
}

export const getEmailTemplateRoute = RouteBuilder.get("/emails/templates/:key")
  .docs({
    tags: ["Emails"],
    summary: "An editable e-mail's wording: repository, draft, published versions",
    description:
      "The placeholders each block may use, the repository's words, the draft with its check, and every published version, newest first.",
  })
  .can("emails.view")
  .params(ParamsSchema)
  .response(
    200,
    z.object({
      key: EditableEmailKeySchema,
      placeholders: z.object({ names: z.array(z.string()), itemNames: z.array(z.string()) }),
      repository: ContentSchema,
      draft: DraftSchema.nullable(),
      published: VersionSchema.nullable(),
      versions: z.array(VersionSchema),
    }),
  )
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const state = await container.useCases.emails.getTemplate.run({ templateKey: request.params.key });
    const { names, itemNames } = emailPlaceholders(state.templateKey, EMAIL_PREVIEW_SAMPLES[state.templateKey]);
    reply.status(200).send({
      key: state.templateKey,
      placeholders: { names, itemNames },
      repository: state.repository,
      draft: state.draft
        ? {
            content: state.draft.content,
            updatedAt: state.draft.updatedAt.toISOString(),
            issues: state.draft.issues,
            warnings: state.draft.warnings,
          }
        : null,
      published: state.published ? versionPayload(state.published, state.repositoryVersion) : null,
      versions: state.versions.map((version) => versionPayload(version, state.repositoryVersion)),
    });
  });

export const saveEmailTemplateDraftRoute = RouteBuilder.put("/emails/templates/:key/draft")
  .docs({
    tags: ["Emails"],
    summary: "Save an editable e-mail's draft",
    description: "Always saves. The answer lists what would stop it from being published, and what is worth a look.",
  })
  .can("emails.templates_edit")
  .params(ParamsSchema)
  .body(z.object({ content: ContentSchema }))
  .response(200, DraftSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const draft = await container.useCases.emails.saveTemplateDraft.run({
      actorId: request.currentUser!.id,
      templateKey: request.params.key,
      content: request.body.content,
    });
    reply.status(200).send({
      content: draft.content,
      updatedAt: draft.updatedAt.toISOString(),
      issues: draft.issues,
      warnings: draft.warnings,
    });
  });

// Renders words the editor holds — saved or not — over the sample data, the
// way the worker would. Writes nothing; refused (with the issues) when the
// words do not pass the check, so the preview never shows half a placeholder.
export const previewEmailTemplateRoute = RouteBuilder.post("/emails/templates/:key/preview")
  .docs({
    tags: ["Emails"],
    summary: "Preview edited e-mail words over sample data",
    description: "Nothing is saved. 422 with the issues when the words in that language do not pass the check.",
  })
  .can("emails.view")
  .params(ParamsSchema)
  .body(z.object({ locale: LocaleSchema, content: ContentSchema }))
  .response(
    200,
    z.object({ locale: LocaleSchema, to: z.string(), subject: z.string(), html: z.string(), text: z.string() }),
  )
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(422, z.object({ issues: z.array(IssueSchema) }))
  .handler(async (request, reply) => {
    const { key } = request.params;
    const { locale, content } = request.body;
    const issues = emailTemplateChecker.check(key, content).issues.filter((issue) => issue.locale === locale);
    const copy = content[locale];
    if (!copy || issues.length > 0) {
      reply.status(422).send({ issues: copy ? issues : [{ code: "locale_missing", locale }] });
      return;
    }
    const to = EMAIL_PREVIEW_RECIPIENTS[EMAIL_CATALOG[key].audience];
    const rendered = renderEmail({ to, templateKey: key, locale, vars: EMAIL_PREVIEW_SAMPLES[key], copy } as OutgoingEmail);
    reply.status(200).send({ locale, to, ...rendered });
  });

export const publishEmailTemplateRoute = RouteBuilder.post("/emails/templates/:key/publish")
  .docs({
    tags: ["Emails"],
    summary: "Publish an editable e-mail's draft",
    description:
      "Creates the next numbered, append-only version, which every e-mail of that template sent from then on is written with. Refused while the draft has issues; the same words as the version in force write nothing (`published: false`).",
  })
  .can("emails.templates_edit")
  .params(ParamsSchema)
  .response(200, z.object({ version: z.number().int(), publishedAt: z.string(), published: z.boolean() }))
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { version, published } = await container.useCases.emails.publishTemplate.run({
      actorId: request.currentUser!.id,
      templateKey: request.params.key,
    });
    reply.status(200).send({ version: version.version, publishedAt: version.createdAt.toISOString(), published });
  });
