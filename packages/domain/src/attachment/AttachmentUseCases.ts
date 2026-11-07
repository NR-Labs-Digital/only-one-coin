// TODO: switch to native crypto.randomUUIDv7() once engines.node requires >=26 (LTS ~out/2026)
import { v7 as uuid } from "uuid";
import type { PresignedReceiptUpload } from "../enrollment/ReceiptStorage.js";
import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import {
  ATTACHMENT_DOWNLOAD_URL_SECONDS,
  ATTACHMENT_PENDING_TTL_MS,
  isAttachmentContentType,
  normalizeAttachmentName,
  type AttachmentActor,
  type AttachmentCategory,
  type AttachmentListItem,
  type AttachmentOwner,
  type StoredAttachment,
} from "./Attachment.js";
import type { AttachmentAccess } from "./AttachmentAccess.js";
import type { IAttachmentRepository, IAttachmentStorage } from "./AttachmentPorts.js";
import { attachmentAuditMetadata } from "./attachmentAudit.js";
import {
  AttachmentNotFoundError,
  AttachmentNotUploadedError,
  AttachmentTooLargeError,
  AttachmentUnsupportedTypeError,
} from "./errors.js";

/** A stored file the actor reaches in the given status, or not found. */
async function reachable(
  repository: IAttachmentRepository,
  access: AttachmentAccess,
  actor: AttachmentActor,
  attachmentId: string,
  status: StoredAttachment["status"],
): Promise<StoredAttachment> {
  const row = await repository.findById(attachmentId);
  if (!row || row.status !== status || !(await access.reaches(actor, row.owner))) {
    throw new AttachmentNotFoundError();
  }
  return row;
}

export interface ListAttachmentsInput {
  actor: AttachmentActor;
  /** Ignored for a student: they only ever read their own files. */
  owner: AttachmentOwner | null;
}

export class ListAttachmentsUseCase extends BaseUseCase<ListAttachmentsInput, AttachmentListItem[]> {
  constructor(
    private readonly repository: IAttachmentRepository,
    private readonly access: AttachmentAccess,
  ) {
    super();
  }

  async run(input: ListAttachmentsInput): Promise<AttachmentListItem[]> {
    const owners = await this.access.ownersFor(input.actor, input.owner);
    return this.repository.listByOwners(
      owners[0]!.type,
      owners.map((owner) => owner.id),
    );
  }
}

export interface RequestAttachmentUploadInput {
  actor: AttachmentActor;
  owner: AttachmentOwner | null;
  category: AttachmentCategory;
  fileName: string;
  contentType: string;
  /** What the browser says the file weighs — checked here so the person hears
   * it before uploading; the bucket's policy is what actually holds the cap. */
  sizeBytes: number;
}

export interface RequestAttachmentUploadOutput {
  attachmentId: string;
  upload: PresignedReceiptUpload;
  maxBytes: number;
}

/**
 * Step one of sending a file: the row is born `pending`, and the browser gets a
 * presigned POST to `documents/<id>` — a key the server names, never the
 * file's own name. The file never passes through the API on the way in.
 */
export class RequestAttachmentUploadUseCase extends BaseUseCase<RequestAttachmentUploadInput, RequestAttachmentUploadOutput> {
  constructor(
    private readonly repository: IAttachmentRepository,
    private readonly storage: IAttachmentStorage,
    private readonly access: AttachmentAccess,
    private readonly maxBytes: number,
  ) {
    super();
  }

  async run(input: RequestAttachmentUploadInput): Promise<RequestAttachmentUploadOutput> {
    const owner = await this.access.ownerFor(input.actor, input.owner);
    if (!isAttachmentContentType(input.contentType)) throw new AttachmentUnsupportedTypeError();
    if (input.sizeBytes > this.maxBytes) throw new AttachmentTooLargeError();

    const attachmentId = uuid();
    const objectKey = `documents/${attachmentId}`;
    await this.repository.create({
      id: attachmentId,
      owner,
      category: input.category,
      objectKey,
      originalName: normalizeAttachmentName(input.fileName),
      mimeType: input.contentType,
      source: this.access.sourceOf(input.actor),
      uploadedBy: input.actor.userId,
    });

    const upload = await this.storage.createUploadTarget({
      objectKey,
      contentType: input.contentType,
      maxBytes: this.maxBytes,
    });
    return { attachmentId, upload, maxBytes: this.maxBytes };
  }
}

export interface AttachmentActionInput {
  actor: AttachmentActor;
  attachmentId: string;
}

/**
 * Step two: read what landed and only then list it. The type comes from the
 * file's own bytes, and the size and checksum from the object — never from
 * what the browser declared (CLAUDE.md §8, magic bytes). A file that fails is
 * deleted from the bucket and the row is `rejected`. Only whoever started the
 * upload confirms it; confirming twice answers the same.
 */
export class ConfirmAttachmentUploadUseCase extends BaseUseCase<AttachmentActionInput, { attachmentId: string }> {
  constructor(
    private readonly repository: IAttachmentRepository,
    private readonly storage: IAttachmentStorage,
    private readonly access: AttachmentAccess,
    private readonly auditLog: IAuditLogRepository,
    private readonly maxBytes: number,
  ) {
    super();
  }

  async run(input: AttachmentActionInput): Promise<{ attachmentId: string }> {
    const row = await this.repository.findById(input.attachmentId);
    if (!row || row.uploadedBy !== input.actor.userId || !(await this.access.reaches(input.actor, row.owner))) {
      throw new AttachmentNotFoundError();
    }
    if (row.status === "uploaded") return { attachmentId: row.id };
    if (row.status !== "pending") throw new AttachmentNotFoundError();

    const landed = await this.storage.inspect(row.objectKey);
    if (!landed) throw new AttachmentNotUploadedError();

    if (landed.byteSize > this.maxBytes) {
      await this.reject(row, "too_large");
      throw new AttachmentTooLargeError();
    }
    if (!isAttachmentContentType(landed.detectedType)) {
      await this.reject(row, "unsupported_type");
      throw new AttachmentUnsupportedTypeError();
    }

    const at = new Date();
    const moved = await this.repository.markUploaded(row.id, {
      mimeType: landed.detectedType,
      sizeBytes: landed.byteSize,
      checksumSha256: landed.checksumSha256,
      at,
    });
    if (moved) {
      await this.auditLog.append({
        actorId: input.actor.userId,
        action: "attachment.uploaded",
        targetId: row.id,
        metadata: attachmentAuditMetadata(row.owner, row.category),
        at,
      });
    }
    return { attachmentId: row.id };
  }

  private async reject(row: StoredAttachment, reason: "too_large" | "unsupported_type"): Promise<void> {
    await this.storage.delete(row.objectKey);
    await this.repository.markRejected(row.id, reason);
  }
}

/** A five-minute link to the file, saved under the name it was sent with.
 * Asked for on the click and logged — never prefetched. */
export class OpenAttachmentUseCase extends BaseUseCase<AttachmentActionInput, { url: string }> {
  constructor(
    private readonly repository: IAttachmentRepository,
    private readonly storage: IAttachmentStorage,
    private readonly access: AttachmentAccess,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: AttachmentActionInput): Promise<{ url: string }> {
    const row = await reachable(this.repository, this.access, input.actor, input.attachmentId, "uploaded");
    const url = await this.storage.createDownloadUrl({
      objectKey: row.objectKey,
      fileName: row.originalName,
      contentType: row.mimeType,
      expiresInSeconds: ATTACHMENT_DOWNLOAD_URL_SECONDS,
    });
    await this.auditLog.append({
      actorId: input.actor.userId,
      action: "attachment.downloaded",
      targetId: row.id,
      metadata: attachmentAuditMetadata(row.owner, row.category),
      at: new Date(),
    });
    return { url };
  }
}

/**
 * Takes a file off the list: `deleted_at`, never a DELETE, and the object
 * stays in the bucket. Staff only — a student has no route to it (proposal of
 * OOC-143: what the student sent is the coordination's record).
 */
export class RemoveAttachmentUseCase extends BaseUseCase<AttachmentActionInput, void> {
  constructor(
    private readonly repository: IAttachmentRepository,
    private readonly access: AttachmentAccess,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: AttachmentActionInput): Promise<void> {
    if (input.actor.role === "student") throw new AttachmentNotFoundError();
    const row = await reachable(this.repository, this.access, input.actor, input.attachmentId, "uploaded");
    const at = new Date();
    const moved = await this.repository.markRemoved(row.id, { by: input.actor.userId, at });
    if (!moved) throw new AttachmentNotFoundError();
    await this.auditLog.append({
      actorId: input.actor.userId,
      action: "attachment.removed",
      targetId: row.id,
      metadata: attachmentAuditMetadata(row.owner, row.category),
      at,
    });
  }
}

/**
 * The sweep: uploads never confirmed are cleared — whatever reached the key is
 * deleted from the bucket and the row is `rejected` (`not_confirmed`). Run by
 * the `attachment-sweep` worker, never a route. A row whose delete fails stays
 * pending and is picked up by the next tick.
 */
export class ExpirePendingAttachmentsUseCase extends BaseUseCase<{ now?: Date }, { expired: number }> {
  constructor(
    private readonly repository: IAttachmentRepository,
    private readonly storage: IAttachmentStorage,
    private readonly batchSize = 100,
  ) {
    super();
  }

  async run(input: { now?: Date } = {}): Promise<{ expired: number }> {
    const now = input.now ?? new Date();
    const stale = await this.repository.listStalePending({
      before: new Date(now.getTime() - ATTACHMENT_PENDING_TTL_MS),
      limit: this.batchSize,
    });
    let expired = 0;
    for (const row of stale) {
      await this.storage.delete(row.objectKey);
      if (await this.repository.markRejected(row.id, "not_confirmed")) expired += 1;
    }
    return { expired };
  }
}
