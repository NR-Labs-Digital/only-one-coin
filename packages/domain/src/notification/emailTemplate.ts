// TODO: switch to native crypto.randomUUIDv7() once engines.node requires >=26 (LTS ~out/2026)
import { v7 as uuid } from "uuid";
import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { ConflictError } from "../shared/base/errors/ConflictError.js";
import { NotFoundError } from "../shared/base/errors/NotFoundError.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";
import { LocaleSchema, type Locale } from "./EmailNotification.js";
import { isEditableEmailKey, type EditableEmailKey } from "./emailCatalog.js";

/**
 * Editable e-mail wording (OOC-60). The words of an automatic e-mail, in one
 * language: the same blocks the repository's locale files carry
 * (`packages/notifications/src/locales`), with `{name}` placeholders. Text, not
 * HTML — the layout, the greeting, the signature and the button's link stay in
 * the code, and every value is escaped when the e-mail is rendered.
 */
export interface EmailCopy {
  subject: string;
  /** The line mail clients show next to the subject, before opening. */
  preheader: string;
  /** Paragraphs in order. Exactly `{items}` stands for the list of a lot e-mail. */
  paragraphs: string[];
  /** The button's label — only on templates with a button. */
  action?: string;
  /** One line of the list — only on templates with a list. */
  item?: string;
  /** Words for vars that carry a code: var → code → label. */
  values?: Record<string, Record<string, string>>;
  /** What an optional var says when it has no value. */
  missing?: string;
}

/**
 * The words of a template in every language. Partial as read: a version
 * published before a fourth language existed has no words in it, and that
 * language falls back to the repository. Publishing requires all of today's.
 */
export type EmailTemplateContent = Partial<Record<Locale, EmailCopy>>;

/**
 * What the check found, as codes and a path — never a sentence (CLAUDE.md §4).
 * `field` is the block (`subject`, `paragraphs`, `values.kind.claim`…), `index`
 * the paragraph, `placeholder` the name between braces.
 */
export interface EmailTemplateIssue {
  code: string;
  locale?: Locale;
  field?: string;
  index?: number;
  placeholder?: string;
}

export interface EmailTemplateCheck {
  /** Stop publishing. */
  issues: EmailTemplateIssue[];
  /** Worth a look, never a stop: a placeholder the repository's wording uses and this one dropped. */
  warnings: EmailTemplateIssue[];
}

export interface EmailTemplateDraft {
  templateKey: EditableEmailKey;
  content: EmailTemplateContent;
  updatedBy: string;
  updatedAt: Date;
}

/** A published version. Append-only, like its table. */
export interface EmailTemplateVersion {
  id: string;
  templateKey: EditableEmailKey;
  version: number;
  content: EmailTemplateContent;
  /** The repository wording's fingerprint when this was published (`templateVersion`). */
  repositoryVersion: string;
  publishedBy: string;
  /** Who published, for the history; null when the account no longer has a name. */
  publishedByName: string | null;
  createdAt: Date;
}

export interface IEmailTemplateRepository {
  findDraft(templateKey: EditableEmailKey): Promise<EmailTemplateDraft | null>;
  saveDraft(draft: EmailTemplateDraft): Promise<EmailTemplateDraft>;
  /** The version in force: the highest number. */
  findPublished(templateKey: string): Promise<EmailTemplateVersion | null>;
  /** Every version, newest first. */
  listVersions(templateKey: EditableEmailKey): Promise<EmailTemplateVersion[]>;
  publish(params: {
    id: string;
    templateKey: EditableEmailKey;
    content: EmailTemplateContent;
    repositoryVersion: string;
    publishedBy: string;
  }): Promise<EmailTemplateVersion>;
}

/** The repository's side of a template: its words, and the check against them. */
export interface IEmailTemplateChecker {
  repositoryContent(templateKey: EditableEmailKey): Record<Locale, EmailCopy>;
  repositoryVersion(templateKey: EditableEmailKey): string;
  check(templateKey: EditableEmailKey, content: EmailTemplateContent): EmailTemplateCheck;
}

export class EmailTemplateNotEditableError extends NotFoundError {
  constructor() {
    super({ reason: "email_template.not_editable", message: "That e-mail's wording is not edited from the panel." });
  }
}

export class EmailTemplateDraftMissingError extends UnableToProcessEntryError {
  constructor() {
    super({ reason: "email_template.draft_missing", message: "There is no draft." });
  }
}

export class EmailTemplateHasIssuesError extends UnableToProcessEntryError {
  constructor() {
    super({ reason: "email_template.has_issues", message: "The wording does not pass the check." });
  }
}

export class EmailTemplatePublishConflictError extends ConflictError {
  constructor(cause?: unknown) {
    super({
      reason: "email_template.publish_conflict",
      message: "Another version was published at the same moment.",
      cause,
    });
  }
}

function editable(templateKey: string): EditableEmailKey {
  if (!isEditableEmailKey(templateKey)) throw new EmailTemplateNotEditableError();
  return templateKey;
}

/** Same words, whatever order the keys came in — publishing them again writes nothing. */
function sameContent(a: EmailTemplateContent, b: EmailTemplateContent): boolean {
  const canonical = (content: EmailTemplateContent) =>
    JSON.stringify(
      LocaleSchema.options.map((locale) => {
        const copy = content[locale];
        if (!copy) return null;
        return [
          copy.subject,
          copy.preheader,
          copy.paragraphs,
          copy.action ?? null,
          copy.item ?? null,
          copy.missing ?? null,
          copy.values
            ? Object.keys(copy.values)
                .sort()
                .map((name) => [name, Object.entries(copy.values![name]!).sort(([x], [y]) => x.localeCompare(y))])
            : null,
        ];
      }),
    );
  return canonical(a) === canonical(b);
}

export interface EmailTemplateState {
  templateKey: EditableEmailKey;
  repository: Record<Locale, EmailCopy>;
  repositoryVersion: string;
  draft: (EmailTemplateDraft & EmailTemplateCheck) | null;
  /** The version in force; null while the repository's words are what goes out. */
  published: EmailTemplateVersion | null;
  versions: EmailTemplateVersion[];
}

/** Everything the editor shows: the repository's words, the draft and its check, the versions. */
export class GetEmailTemplateUseCase extends BaseUseCase<{ templateKey: string }, EmailTemplateState> {
  constructor(
    private readonly templates: IEmailTemplateRepository,
    private readonly checker: IEmailTemplateChecker,
  ) {
    super();
  }

  async run(input: { templateKey: string }): Promise<EmailTemplateState> {
    const templateKey = editable(input.templateKey);
    const [draft, versions] = await Promise.all([
      this.templates.findDraft(templateKey),
      this.templates.listVersions(templateKey),
    ]);
    return {
      templateKey,
      repository: this.checker.repositoryContent(templateKey),
      repositoryVersion: this.checker.repositoryVersion(templateKey),
      draft: draft ? { ...draft, ...this.checker.check(templateKey, draft.content) } : null,
      published: versions[0] ?? null,
      versions,
    };
  }
}

/**
 * Saves what the person is writing. A draft may be wrong — it is saved either
 * way, and the answer says what would stop it from being published. Not
 * audited: a draft sends nothing. Publishing is.
 */
export class SaveEmailTemplateDraftUseCase extends BaseUseCase<
  { actorId: string; templateKey: string; content: EmailTemplateContent },
  EmailTemplateDraft & EmailTemplateCheck
> {
  constructor(
    private readonly templates: IEmailTemplateRepository,
    private readonly checker: IEmailTemplateChecker,
  ) {
    super();
  }

  async run(input: { actorId: string; templateKey: string; content: EmailTemplateContent }) {
    const templateKey = editable(input.templateKey);
    const draft = await this.templates.saveDraft({
      templateKey,
      content: input.content,
      updatedBy: input.actorId,
      updatedAt: new Date(),
    });
    return { ...draft, ...this.checker.check(templateKey, draft.content) };
  }
}

/**
 * Makes the draft what the e-mail says from now on: a new, numbered, immutable
 * version, which the send-email worker reads at the moment it sends. Refused
 * while the draft does not pass the check (every language, no unknown
 * placeholder). Publishing the words already in force writes nothing.
 */
export class PublishEmailTemplateUseCase extends BaseUseCase<
  { actorId: string; templateKey: string },
  { version: EmailTemplateVersion; published: boolean }
> {
  constructor(
    private readonly templates: IEmailTemplateRepository,
    private readonly checker: IEmailTemplateChecker,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: { actorId: string; templateKey: string }) {
    const templateKey = editable(input.templateKey);
    const draft = await this.templates.findDraft(templateKey);
    if (!draft) throw new EmailTemplateDraftMissingError();
    if (this.checker.check(templateKey, draft.content).issues.length > 0) throw new EmailTemplateHasIssuesError();

    const current = await this.templates.findPublished(templateKey);
    if (current && sameContent(current.content, draft.content)) return { version: current, published: false };

    const version = await this.templates.publish({
      id: uuid(),
      templateKey,
      content: draft.content,
      repositoryVersion: this.checker.repositoryVersion(templateKey),
      publishedBy: input.actorId,
    });

    await this.auditLog.append({
      actorId: input.actorId,
      action: "email_template.published",
      targetId: version.id,
      metadata: { template: templateKey, version: version.version },
      at: version.createdAt,
    });

    return { version, published: true };
  }
}

/**
 * The draft's words in one language, for a proof sent before publishing. Only
 * a draft that passes the check: a proof is what the student would receive.
 */
export class GetEmailTemplateDraftCopyUseCase extends BaseUseCase<
  { templateKey: string; locale: Locale },
  EmailCopy
> {
  constructor(
    private readonly templates: IEmailTemplateRepository,
    private readonly checker: IEmailTemplateChecker,
  ) {
    super();
  }

  async run(input: { templateKey: string; locale: Locale }): Promise<EmailCopy> {
    const templateKey = editable(input.templateKey);
    const draft = await this.templates.findDraft(templateKey);
    if (!draft) throw new EmailTemplateDraftMissingError();
    if (this.checker.check(templateKey, draft.content).issues.length > 0) throw new EmailTemplateHasIssuesError();
    const copy = draft.content[input.locale];
    if (!copy) throw new EmailTemplateHasIssuesError();
    return copy;
  }
}
