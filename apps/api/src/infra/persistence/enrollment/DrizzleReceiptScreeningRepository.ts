import {
  MAX_LOOKALIKE_SIGNALS,
  type IReceiptScreeningRepository,
  type ReceiptExifFacts,
  type ReceiptLookalike,
  type ReceiptScreeningSubject,
} from "@ooc/domain";
import { enrollments, payments, receiptUploads } from "@ooc/db";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { insertOutboxEmails } from "@/infra/persistence/notification/DrizzleOutboxRepository.js";
import { SIMILAR_IMAGE_MAX_DISTANCE } from "@/infra/storage/fingerprintReceiptImage.js";

interface LookalikeRow extends Record<string, unknown> {
  id: string;
  payment_id: string;
  identical: boolean;
  distance: number | string | null;
}

export class DrizzleReceiptScreeningRepository implements IReceiptScreeningRepository {
  constructor(private readonly db: Db) {}

  async findSubject(receiptUploadId: string): Promise<ReceiptScreeningSubject | null> {
    const [row] = await this.db
      .select({
        id: receiptUploads.id,
        paymentId: receiptUploads.paymentId,
        exifFacts: receiptUploads.exifFacts,
        studentId: enrollments.studentId,
        classGroupId: enrollments.classGroupId,
      })
      .from(receiptUploads)
      .innerJoin(payments, eq(payments.id, receiptUploads.paymentId))
      .innerJoin(enrollments, eq(enrollments.id, payments.enrollmentId))
      .where(
        and(
          eq(receiptUploads.id, receiptUploadId),
          eq(receiptUploads.status, "processed"),
          isNotNull(receiptUploads.paymentId),
          isNull(receiptUploads.screenedAt),
        ),
      )
      .limit(1);

    if (!row?.paymentId) {
      return null;
    }

    return {
      receiptUploadId: row.id,
      paymentId: row.paymentId,
      studentId: row.studentId,
      classGroupId: row.classGroupId,
      exif: (row.exifFacts as ReceiptExifFacts | null) ?? null,
    };
  }

  /**
   * `fingerprintDistance` (fingerprintReceiptImage.ts) in SQL: the closest
   * of whole-vs-whole and whole-vs-each-crop, both ways round, as the
   * popcount of the XOR. Only receipts attached to a *different* payment
   * count — the same photo uploaded again in a new checkout after the hold
   * ran out has no payment behind the first copy, and is not a reuse.
   *
   * A sequential scan over processed receipts, about a hundred popcounts
   * per row (49 crops each way): at 20k receipts a month that is milliseconds for years, and it
   * runs in the worker, never on a request.
   */
  async findLookalikes(subject: ReceiptScreeningSubject): Promise<ReceiptLookalike[]> {
    const result = await this.db.execute<LookalikeRow>(sql`
      with subject as (
        select image_sha256, image_phash, image_phash_crops
          from receipt_uploads
         where id = ${subject.receiptUploadId}
      ),
      scored as (
        select other.id,
               other.payment_id,
               other.created_at,
               other.image_sha256 = subject.image_sha256 as identical,
               least(
                 bit_count((other.image_phash # subject.image_phash)::bit(64)),
                 (select min(bit_count((crop # subject.image_phash)::bit(64)))
                    from unnest(other.image_phash_crops) as crop),
                 (select min(bit_count((other.image_phash # crop)::bit(64)))
                    from unnest(subject.image_phash_crops) as crop)
               ) as distance
          from receipt_uploads as other, subject
         where other.id <> ${subject.receiptUploadId}
           and other.status = 'processed'
           and other.payment_id is not null
           and other.payment_id <> ${subject.paymentId}
           and other.image_phash is not null
           and subject.image_phash is not null
      )
      select id, payment_id, identical, distance
        from scored
       where identical or distance <= ${SIMILAR_IMAGE_MAX_DISTANCE}
       order by identical desc, distance asc, created_at desc
       limit ${MAX_LOOKALIKE_SIGNALS}
    `);

    return result.rows.map((row) => ({
      receiptUploadId: row.id,
      paymentId: row.payment_id,
      match: row.identical
        ? { kind: "identical" as const }
        : { kind: "similar" as const, distance: Number(row.distance) },
    }));
  }

  async recordScreening(params: Parameters<IReceiptScreeningRepository["recordScreening"]>[0]): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [stamped] = await tx
        .update(receiptUploads)
        .set({ fraudSignals: params.signals, screenedAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(eq(receiptUploads.id, params.receiptUploadId), isNull(receiptUploads.screenedAt)))
        .returning({ id: receiptUploads.id });

      // A redelivered job finds the row already stamped and changes nothing.
      if (!stamped || !params.routeToReview) {
        return;
      }

      const [routed] = await tx
        .update(payments)
        .set({ status: "under_review", updatedAt: sql`now()` })
        .where(and(eq(payments.id, params.paymentId), eq(payments.status, "pending")))
        .returning({ id: payments.id });

      // Only the move tells the student: a payment already in review (or
      // settled) is not news.
      if (routed) {
        await insertOutboxEmails(tx, params.notifications);
      }
    });
  }
}
