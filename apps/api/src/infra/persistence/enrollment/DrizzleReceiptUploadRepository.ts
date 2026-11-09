import type { IReceiptUploadRepository, ReceiptExifFacts, ReceiptUpload, ReceiptUploadOwner, ReceiptUploadStatus } from "@ooc/domain";
import { paymentReceipts, receiptUploads } from "@ooc/db";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import type { ReceiptFingerprint } from "@/infra/storage/fingerprintReceiptImage.js";

/**
 * The half of `receipt_uploads` only the normalize worker uses — same
 * reasoning as `IOutboxStore` in `DrizzleOutboxRepository.ts`: a worker-only
 * read/write shape kept out of the domain port (`IReceiptUploadRepository`),
 * which is scoped to what the two HTTP-facing usecases need.
 */
export interface IReceiptNormalizationStore {
  listUploadedIds(limit: number): Promise<string[]>;
  /** Normalized, attached to a payment, not screened yet — what the relay
   * offers to the `receipt-screen` queue (OOC-22). */
  listScreenableIds(limit: number): Promise<string[]>;
  /** Normalized, attached to a payment, and with no `payment_receipts` row
   * at `tier` yet — what the relay offers to the `receipt-extract` queue
   * (OOC-20). */
  listExtractableIds(limit: number, tier: number): Promise<string[]>;
  /** Screened, attached to a payment, with a level-1 row (a reading or a
   * recorded failure) and no verdict yet — what the relay offers to the
   * `receipt-validate` queue (OOC-21). */
  listValidatableIds(limit: number, tier: number): Promise<string[]>;
  /** The processed key and the fingerprint land in the same statement: a
   * `processed` row always has what the screening compares. */
  markProcessed(
    id: string,
    params: { processedObjectKey: string; fingerprint: ReceiptFingerprint; exif: ReceiptExifFacts | null },
  ): Promise<ReceiptUpload | null>;
  markRejected(id: string, reason: string): Promise<ReceiptUpload | null>;
}

export class DrizzleReceiptUploadRepository implements IReceiptUploadRepository, IReceiptNormalizationStore {
  constructor(private readonly db: Db) {}

  async create(params: { id: string; owner: ReceiptUploadOwner; objectKey: string; contentType: string }): Promise<ReceiptUpload> {
    const [row] = await this.db
      .insert(receiptUploads)
      .values({
        id: params.id,
        seatHoldId: params.owner.kind === "seat_hold" ? params.owner.seatHoldId : null,
        procedureRequestId: params.owner.kind === "procedure_request" ? params.owner.procedureRequestId : null,
        uploadedBy: params.owner.kind === "staff" ? params.owner.userId : null,
        objectKey: params.objectKey,
        contentType: params.contentType,
      })
      .returning();

    if (!row) {
      throw new Error("Insert into receipt_uploads returned no row");
    }

    return toReceiptUpload(row);
  }

  async findById(id: string): Promise<ReceiptUpload | null> {
    const [row] = await this.db.select().from(receiptUploads).where(eq(receiptUploads.id, id)).limit(1);
    return row ? toReceiptUpload(row) : null;
  }

  async markUploaded(id: string, params: { contentType: string; byteSize: number }): Promise<ReceiptUpload | null> {
    const [row] = await this.db
      .update(receiptUploads)
      .set({ status: "uploaded", contentType: params.contentType, byteSize: params.byteSize, updatedAt: new Date() })
      .where(and(eq(receiptUploads.id, id), eq(receiptUploads.status, "pending")))
      .returning();

    return row ? toReceiptUpload(row) : null;
  }

  async listUploadedIds(limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: receiptUploads.id })
      .from(receiptUploads)
      .where(eq(receiptUploads.status, "uploaded"))
      .orderBy(asc(receiptUploads.createdAt))
      .limit(limit);

    return rows.map((row) => row.id);
  }

  async listScreenableIds(limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: receiptUploads.id })
      .from(receiptUploads)
      .where(
        and(
          eq(receiptUploads.status, "processed"),
          isNotNull(receiptUploads.paymentId),
          isNull(receiptUploads.screenedAt),
        ),
      )
      .orderBy(asc(receiptUploads.createdAt))
      .limit(limit);

    return rows.map((row) => row.id);
  }

  /**
   * An anti-join against `payment_receipts`, which its unique
   * (receipt_upload_id, tier) index serves. Unlike the screening there is no
   * stamp column on `receipt_uploads` to put a partial index on — the
   * reading's own row is the stamp, so the two can never disagree. Every
   * failed extraction writes its row too, so nothing is offered forever.
   */
  async listExtractableIds(limit: number, tier: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: receiptUploads.id })
      .from(receiptUploads)
      .where(
        and(
          eq(receiptUploads.status, "processed"),
          isNotNull(receiptUploads.paymentId),
          sql`not exists (
            select 1 from ${paymentReceipts}
             where ${paymentReceipts.receiptUploadId} = ${receiptUploads.id}
               and ${paymentReceipts.tier} = ${tier}
          )`,
        ),
      )
      .orderBy(asc(receiptUploads.createdAt))
      .limit(limit);

    return rows.map((row) => row.id);
  }

  async listValidatableIds(limit: number, tier: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: receiptUploads.id })
      .from(receiptUploads)
      .where(
        and(
          isNotNull(receiptUploads.paymentId),
          isNotNull(receiptUploads.screenedAt),
          isNull(receiptUploads.validatedAt),
          sql`exists (
            select 1 from ${paymentReceipts}
             where ${paymentReceipts.receiptUploadId} = ${receiptUploads.id}
               and ${paymentReceipts.tier} = ${tier}
          )`,
        ),
      )
      .orderBy(asc(receiptUploads.createdAt))
      .limit(limit);

    return rows.map((row) => row.id);
  }

  async markProcessed(
    id: string,
    params: { processedObjectKey: string; fingerprint: ReceiptFingerprint; exif: ReceiptExifFacts | null },
  ): Promise<ReceiptUpload | null> {
    const [row] = await this.db
      .update(receiptUploads)
      .set({
        status: "processed",
        processedObjectKey: params.processedObjectKey,
        imageSha256: params.fingerprint.sha256,
        imagePhash: params.fingerprint.phash,
        imagePhashCrops: params.fingerprint.crops,
        exifFacts: params.exif,
        updatedAt: new Date(),
      })
      .where(and(eq(receiptUploads.id, id), eq(receiptUploads.status, "uploaded")))
      .returning();

    return row ? toReceiptUpload(row) : null;
  }

  async markRejected(id: string, reason: string): Promise<ReceiptUpload | null> {
    const [row] = await this.db
      .update(receiptUploads)
      .set({ status: "rejected", rejectionReason: reason, updatedAt: new Date() })
      .where(and(eq(receiptUploads.id, id), eq(receiptUploads.status, "uploaded")))
      .returning();

    return row ? toReceiptUpload(row) : null;
  }
}

function toReceiptUpload(row: typeof receiptUploads.$inferSelect): ReceiptUpload {
  return {
    id: row.id,
    seatHoldId: row.seatHoldId,
    procedureRequestId: row.procedureRequestId,
    uploadedBy: row.uploadedBy,
    paymentId: row.paymentId,
    objectKey: row.objectKey,
    status: row.status as ReceiptUploadStatus,
    processedObjectKey: row.processedObjectKey,
  };
}
