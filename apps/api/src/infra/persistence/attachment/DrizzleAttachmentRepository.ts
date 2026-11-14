import type {
  AttachmentCategory,
  AttachmentListItem,
  AttachmentOwner,
  AttachmentOwnerType,
  AttachmentRejectionReason,
  AttachmentSource,
  AttachmentStatus,
  IAttachmentOwners,
  IAttachmentRepository,
  NewAttachment,
  StoredAttachment,
  UploadedAttachmentFacts,
} from "@ooc/domain";
import { documents, students } from "@ooc/db";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { pickProfile, profilesOfAccount } from "@/infra/persistence/portal/accountProfiles.js";
import { reachesStudent } from "@/infra/persistence/portal/reachableStudents.js";

/**
 * The `documents` table (OOC-143). Every status change is a conditional UPDATE
 * on the status it leaves — never read, compare and write — so two confirms, or
 * a confirm racing the sweep, move a row once.
 */
export class DrizzleAttachmentRepository implements IAttachmentRepository {
  constructor(private readonly db: Db) {}

  async create(row: NewAttachment): Promise<void> {
    await this.db.insert(documents).values({
      id: row.id,
      ownerType: row.owner.type,
      ownerId: row.owner.id,
      category: row.category,
      objectKey: row.objectKey,
      originalName: row.originalName,
      mimeType: row.mimeType,
      source: row.source,
      uploadedBy: row.uploadedBy,
    });
  }

  async findById(id: string): Promise<StoredAttachment | null> {
    const [row] = await this.db
      .select({
        id: documents.id,
        ownerType: documents.ownerType,
        ownerId: documents.ownerId,
        category: documents.category,
        objectKey: documents.objectKey,
        originalName: documents.originalName,
        mimeType: documents.mimeType,
        uploadedBy: documents.uploadedBy,
        status: documents.status,
      })
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      owner: { type: row.ownerType as AttachmentOwnerType, id: row.ownerId },
      category: row.category as AttachmentCategory,
      objectKey: row.objectKey,
      originalName: row.originalName,
      mimeType: row.mimeType,
      uploadedBy: row.uploadedBy,
      status: row.status as AttachmentStatus,
    };
  }

  async markUploaded(id: string, facts: UploadedAttachmentFacts): Promise<boolean> {
    const moved = await this.db
      .update(documents)
      .set({
        status: "uploaded",
        mimeType: facts.mimeType,
        sizeBytes: facts.sizeBytes,
        checksumSha256: facts.checksumSha256,
        uploadedAt: facts.at,
        updatedAt: facts.at,
      })
      .where(and(eq(documents.id, id), eq(documents.status, "pending")))
      .returning({ id: documents.id });
    return moved.length > 0;
  }

  async markRejected(id: string, reason: AttachmentRejectionReason): Promise<boolean> {
    const moved = await this.db
      .update(documents)
      .set({ status: "rejected", rejectionReason: reason, updatedAt: sql`now()` })
      .where(and(eq(documents.id, id), eq(documents.status, "pending")))
      .returning({ id: documents.id });
    return moved.length > 0;
  }

  async markRemoved(id: string, params: { by: string; at: Date }): Promise<boolean> {
    const moved = await this.db
      .update(documents)
      .set({ status: "removed", removedBy: params.by, deletedAt: params.at, updatedAt: params.at })
      .where(and(eq(documents.id, id), eq(documents.status, "uploaded"), isNull(documents.deletedAt)))
      .returning({ id: documents.id });
    return moved.length > 0;
  }

  async listByOwners(ownerType: AttachmentOwnerType, ownerIds: readonly string[]): Promise<AttachmentListItem[]> {
    if (ownerIds.length === 0) return [];
    const rows = await this.db
      .select({
        id: documents.id,
        category: documents.category,
        originalName: documents.originalName,
        mimeType: documents.mimeType,
        sizeBytes: documents.sizeBytes,
        source: documents.source,
        uploadedAt: documents.uploadedAt,
        // "user" is Better Auth's table, not modelled in the Drizzle schema.
        uploadedByName: sql<string | null>`(select "name" from "user" where "id" = ${documents.uploadedBy})`,
      })
      .from(documents)
      .where(
        and(
          eq(documents.ownerType, ownerType),
          inArray(documents.ownerId, [...ownerIds]),
          eq(documents.status, "uploaded"),
          isNull(documents.deletedAt),
        ),
      )
      .orderBy(desc(documents.createdAt), desc(documents.id));

    return rows.map((row) => ({
      id: row.id,
      category: row.category as AttachmentCategory,
      originalName: row.originalName,
      mimeType: row.mimeType,
      // The CHECK holds both for an uploaded row.
      sizeBytes: row.sizeBytes ?? 0,
      source: row.source as AttachmentSource,
      uploadedAt: row.uploadedAt ?? new Date(0),
      uploadedByName: row.uploadedByName,
    }));
  }

  async listStalePending(params: { before: Date; limit: number }): Promise<{ id: string; objectKey: string }[]> {
    return this.db
      .select({ id: documents.id, objectKey: documents.objectKey })
      .from(documents)
      .where(and(eq(documents.status, "pending"), lt(documents.createdAt, params.before)))
      .orderBy(asc(documents.createdAt))
      .limit(params.limit);
  }
}

/** Who owns attachments, for the access rule. */
export class DrizzleAttachmentOwners implements IAttachmentOwners {
  constructor(private readonly db: Db) {}

  async exists(owner: AttachmentOwner): Promise<boolean> {
    switch (owner.type) {
      case "student": {
        const [row] = await this.db
          .select({ id: students.id })
          .from(students)
          .where(and(eq(students.id, owner.id), isNull(students.deletedAt)))
          .limit(1);
        return row !== undefined;
      }
    }
  }

  async studentsOfAccount(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: students.id })
      .from(students)
      .where(reachesStudent(userId))
      .orderBy(desc(students.createdAt));
    return rows.map((row) => row.id);
  }

  async studentsOfProfile(userId: string, profileId: string | null): Promise<string[]> {
    return pickProfile(await profilesOfAccount(this.db, userId), profileId)?.fileIds ?? [];
  }
}
