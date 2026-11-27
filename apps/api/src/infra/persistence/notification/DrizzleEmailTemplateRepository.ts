import { emailTemplateDrafts, emailTemplateVersions } from "@ooc/db";
import {
  EmailTemplatePublishConflictError,
  type EditableEmailKey,
  type EmailTemplateContent,
  type EmailTemplateDraft,
  type EmailTemplateVersion,
  type IEmailTemplateRepository,
} from "@ooc/domain";
import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { isUniqueViolation } from "@/infra/db/isUniqueViolation.js";
import type { PublishedEmailWording } from "@/workers/deliverOutboxEmail.js";

/** Who published, read off Better Auth's "user" (not in the Drizzle schema). */
const publisherName = sql<string | null>`(select u."name" from "user" u where u."id" = ${emailTemplateVersions.publishedBy})`;

const versionColumns = {
  id: emailTemplateVersions.id,
  templateKey: emailTemplateVersions.templateKey,
  version: emailTemplateVersions.version,
  content: emailTemplateVersions.content,
  repositoryVersion: emailTemplateVersions.repositoryVersion,
  publishedBy: emailTemplateVersions.publishedBy,
  publishedByName: publisherName,
  createdAt: emailTemplateVersions.createdAt,
};

type VersionRow = {
  id: string;
  templateKey: string;
  version: number;
  content: unknown;
  repositoryVersion: string;
  publishedBy: string;
  publishedByName: string | null;
  createdAt: Date;
};

function toVersion(row: VersionRow): EmailTemplateVersion {
  return {
    ...row,
    templateKey: row.templateKey as EditableEmailKey,
    content: row.content as EmailTemplateContent,
    publishedByName: row.publishedByName?.trim() ? row.publishedByName : null,
  };
}

/**
 * Editable e-mail wording (OOC-60). Drafts are one mutable row per template
 * (upsert on the unique key); versions are append-only (0082 lock) and
 * numbered in the same statement that inserts them, so two publishes never
 * write the same number — and if they race anyway, the unique (key, version)
 * refuses one. Also the send-email worker's source of the words in force.
 */
export class DrizzleEmailTemplateRepository implements IEmailTemplateRepository, PublishedEmailWording {
  constructor(private readonly db: Db) {}

  async findDraft(templateKey: EditableEmailKey): Promise<EmailTemplateDraft | null> {
    const [row] = await this.db
      .select()
      .from(emailTemplateDrafts)
      .where(eq(emailTemplateDrafts.templateKey, templateKey))
      .limit(1);
    return row
      ? {
          templateKey,
          content: row.content as EmailTemplateContent,
          updatedBy: row.updatedBy,
          updatedAt: row.updatedAt,
        }
      : null;
  }

  async saveDraft(draft: EmailTemplateDraft): Promise<EmailTemplateDraft> {
    const [row] = await this.db
      .insert(emailTemplateDrafts)
      .values({
        templateKey: draft.templateKey,
        content: draft.content,
        updatedBy: draft.updatedBy,
        updatedAt: draft.updatedAt,
      })
      .onConflictDoUpdate({
        target: emailTemplateDrafts.templateKey,
        set: { content: draft.content, updatedBy: draft.updatedBy, updatedAt: draft.updatedAt },
      })
      .returning();
    return {
      templateKey: draft.templateKey,
      content: row!.content as EmailTemplateContent,
      updatedBy: row!.updatedBy,
      updatedAt: row!.updatedAt,
    };
  }

  async findPublished(templateKey: string): Promise<EmailTemplateVersion | null> {
    const [row] = await this.db
      .select(versionColumns)
      .from(emailTemplateVersions)
      .where(eq(emailTemplateVersions.templateKey, templateKey))
      .orderBy(desc(emailTemplateVersions.version))
      .limit(1);
    return row ? toVersion(row) : null;
  }

  async listVersions(templateKey: EditableEmailKey): Promise<EmailTemplateVersion[]> {
    const rows = await this.db
      .select(versionColumns)
      .from(emailTemplateVersions)
      .where(eq(emailTemplateVersions.templateKey, templateKey))
      .orderBy(desc(emailTemplateVersions.version));
    return rows.map(toVersion);
  }

  async publish(params: {
    id: string;
    templateKey: EditableEmailKey;
    content: EmailTemplateContent;
    repositoryVersion: string;
    publishedBy: string;
  }): Promise<EmailTemplateVersion> {
    try {
      const [row] = await this.db
        .insert(emailTemplateVersions)
        .values({
          id: params.id,
          templateKey: params.templateKey,
          content: params.content,
          repositoryVersion: params.repositoryVersion,
          publishedBy: params.publishedBy,
          version: sql`(select coalesce(max(${emailTemplateVersions.version}), 0) + 1
            from ${emailTemplateVersions} where ${emailTemplateVersions.templateKey} = ${params.templateKey})`,
        })
        .returning({ id: emailTemplateVersions.id });
      const version = await this.findPublishedById(row!.id);
      return version!;
    } catch (error) {
      if (isUniqueViolation(error, "email_template_versions_template_key_version_uidx")) {
        throw new EmailTemplatePublishConflictError(error);
      }
      throw error;
    }
  }

  /** The number in force of every template that has one — the e-mail catalog's column. */
  async latestVersionNumbers(): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ templateKey: emailTemplateVersions.templateKey, version: sql<number>`max(${emailTemplateVersions.version})::int` })
      .from(emailTemplateVersions)
      .groupBy(emailTemplateVersions.templateKey);
    return Object.fromEntries(rows.map((row) => [row.templateKey, row.version]));
  }

  private async findPublishedById(id: string): Promise<EmailTemplateVersion | null> {
    const [row] = await this.db.select(versionColumns).from(emailTemplateVersions).where(eq(emailTemplateVersions.id, id));
    return row ? toVersion(row) : null;
  }
}
