import { documentTemplateDrafts, documentTemplateVersions } from "@ooc/db";
import {
  ConflictError,
  DocumentTemplateVersion,
  type DocumentTemplateDraft,
  type IDocumentTemplateRepository,
} from "@ooc/domain";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { isUniqueViolation } from "@/infra/db/isUniqueViolation.js";

type VersionRow = typeof documentTemplateVersions.$inferSelect;

function toVersion(row: VersionRow): DocumentTemplateVersion {
  return new DocumentTemplateVersion({
    id: row.id,
    kind: row.kind,
    version: row.version,
    body: row.body,
    publishedBy: row.publishedBy,
    createdAt: row.createdAt,
  });
}

/**
 * Drafts are one mutable row per kind (upsert on the unique `kind`); versions
 * are append-only (0034 lock) and numbered in the same statement that inserts
 * them, so two publishes never read the same "highest" and write the same
 * number — and if they race anyway, the unique (kind, version) refuses one.
 */
export class DrizzleDocumentTemplateRepository implements IDocumentTemplateRepository {
  constructor(private readonly db: Db) {}

  async findDraft(kind: string): Promise<DocumentTemplateDraft | null> {
    const [row] = await this.db
      .select()
      .from(documentTemplateDrafts)
      .where(eq(documentTemplateDrafts.kind, kind))
      .limit(1);
    return row ? { kind: row.kind, body: row.body, updatedBy: row.updatedBy, updatedAt: row.updatedAt } : null;
  }

  async saveDraft(draft: DocumentTemplateDraft): Promise<DocumentTemplateDraft> {
    const [row] = await this.db
      .insert(documentTemplateDrafts)
      .values({ kind: draft.kind, body: draft.body, updatedBy: draft.updatedBy, updatedAt: draft.updatedAt })
      .onConflictDoUpdate({
        target: documentTemplateDrafts.kind,
        set: { body: draft.body, updatedBy: draft.updatedBy, updatedAt: draft.updatedAt },
      })
      .returning();
    return { kind: row!.kind, body: row!.body, updatedBy: row!.updatedBy, updatedAt: row!.updatedAt };
  }

  async findPublished(kind: string): Promise<DocumentTemplateVersion | null> {
    const [row] = await this.db
      .select()
      .from(documentTemplateVersions)
      .where(eq(documentTemplateVersions.kind, kind))
      .orderBy(desc(documentTemplateVersions.version))
      .limit(1);
    return row ? toVersion(row) : null;
  }

  async findVersion(kind: string, id: string): Promise<DocumentTemplateVersion | null> {
    const [row] = await this.db
      .select()
      .from(documentTemplateVersions)
      .where(and(eq(documentTemplateVersions.kind, kind), eq(documentTemplateVersions.id, id)))
      .limit(1);
    return row ? toVersion(row) : null;
  }

  async publish(params: { id: string; kind: string; body: string; publishedBy: string }): Promise<DocumentTemplateVersion> {
    try {
      const [row] = await this.db
        .insert(documentTemplateVersions)
        .values({
          id: params.id,
          kind: params.kind,
          body: params.body,
          publishedBy: params.publishedBy,
          version: sql`(select coalesce(max(${documentTemplateVersions.version}), 0) + 1
            from ${documentTemplateVersions} where ${documentTemplateVersions.kind} = ${params.kind})`,
        })
        .returning();
      return toVersion(row!);
    } catch (error) {
      if (isUniqueViolation(error, "document_template_versions_kind_version_uidx")) {
        throw new ConflictError({
          reason: "document_template.publish_conflict",
          message: "Another version was published at the same moment.",
          cause: error,
        });
      }
      throw error;
    }
  }
}
