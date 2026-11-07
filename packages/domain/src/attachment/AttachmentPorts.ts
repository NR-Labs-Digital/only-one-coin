import type { PresignedReceiptUpload } from "../enrollment/ReceiptStorage.js";
import type {
  AttachmentCategory,
  AttachmentListItem,
  AttachmentOwner,
  AttachmentRejectionReason,
  AttachmentSource,
  StoredAttachment,
} from "./Attachment.js";

export interface NewAttachment {
  id: string;
  owner: AttachmentOwner;
  category: AttachmentCategory;
  objectKey: string;
  originalName: string;
  mimeType: string;
  source: AttachmentSource;
  uploadedBy: string;
}

export interface UploadedAttachmentFacts {
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  at: Date;
}

/** The `documents` table. Every status change is conditional on the status
 * it leaves, and answers whether it moved. */
export interface IAttachmentRepository {
  create(row: NewAttachment): Promise<void>;
  findById(id: string): Promise<StoredAttachment | null>;
  /** pending → uploaded. */
  markUploaded(id: string, facts: UploadedAttachmentFacts): Promise<boolean>;
  /** pending → rejected. */
  markRejected(id: string, reason: AttachmentRejectionReason): Promise<boolean>;
  /** uploaded → removed, with `deleted_at` (soft delete — never a DELETE). */
  markRemoved(id: string, params: { by: string; at: Date }): Promise<boolean>;
  /** The live files of these owners of one type, newest first. */
  listByOwners(ownerType: AttachmentOwner["type"], ownerIds: readonly string[]): Promise<AttachmentListItem[]>;
  /** Uploads still pending since before `before`, oldest first. */
  listStalePending(params: { before: Date; limit: number }): Promise<{ id: string; objectKey: string }[]>;
}

/** What actually landed at a key, read from the object itself. */
export interface AttachmentInspection {
  byteSize: number;
  checksumSha256: string;
  /** What the file's first bytes say it is; null when they say nothing known. */
  detectedType: string | null;
}

/** The one bucket, reduced to what attachments need. */
export interface IAttachmentStorage {
  /** A presigned POST to `objectKey`, capped at `maxBytes` by the bucket's own policy. */
  createUploadTarget(params: { objectKey: string; contentType: string; maxBytes: number }): Promise<PresignedReceiptUpload>;
  /** Null when nothing is at the key yet. */
  inspect(objectKey: string): Promise<AttachmentInspection | null>;
  /** A GET link that dies in `expiresInSeconds` and saves under `fileName`. */
  createDownloadUrl(params: {
    objectKey: string;
    fileName: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<string>;
  /** No-op when nothing is there. */
  delete(objectKey: string): Promise<void>;
}

/** Who the owners are, for the access rule. */
export interface IAttachmentOwners {
  /** A live record of that type with that id. */
  exists(owner: AttachmentOwner): Promise<boolean>;
  /** The live student files behind a portal account, newest first. More than
   * one while duplicates are not consolidated (`students.user_id` is not
   * unique); empty when there is none. */
  studentsOfAccount(userId: string): Promise<string[]>;
}
