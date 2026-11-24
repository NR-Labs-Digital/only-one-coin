import { complaintCodeOf, type EmailNotification, type FiledComplaint, type IComplaintRepository, type NewComplaint } from "@ooc/domain";
import { complaints } from "@ooc/db";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { insertOutboxEmails } from "@/infra/persistence/notification/DrizzleOutboxRepository.js";

/**
 * The complaints book (OOC-63). The sheet and the consumer's copy commit
 * together; the number comes from `complaint_number_seq`, so two sheets filed
 * at once never share one. A number drawn by an insert that loses the
 * idempotency race is skipped, never reused — a gap in the book, not a repeat.
 */
export class DrizzleComplaintRepository implements IComplaintRepository {
  constructor(private readonly db: Db) {}

  findByIdempotencyKey(idempotencyKey: string): Promise<FiledComplaint | null> {
    return this.findByKey(this.db, idempotencyKey);
  }

  async file(complaint: NewComplaint, emails: (filed: FiledComplaint) => EmailNotification[]): Promise<FiledComplaint> {
    return this.db.transaction(async (tx) => {
      const already = await this.findByKey(tx, complaint.idempotencyKey);
      if (already) return already;

      // The year of the sheet is Lima's, like every date the consumer reads.
      const drawn = await tx.execute<{ n: string; year: number }>(
        sql`select nextval('complaint_number_seq')::text as n, extract(year from now() at time zone 'America/Lima')::int as year`,
      );
      const { n, year } = drawn.rows[0]!;
      const code = complaintCodeOf(year, Number(n));

      const { form } = complaint;
      const [row] = await tx
        .insert(complaints)
        .values({
          code,
          kind: form.kind,
          supplierLegalName: complaint.supplier.legalName,
          supplierRuc: complaint.supplier.ruc,
          supplierAddress: complaint.supplier.address,
          consumerFirstName: form.consumer.firstName,
          consumerLastName: form.consumer.lastName,
          consumerSecondLastName: form.consumer.secondLastName,
          consumerNationalIdType: form.consumer.nationalIdType,
          consumerNationalId: form.consumer.nationalId,
          consumerPhone: form.consumer.phone,
          consumerEmail: form.consumer.email,
          consumerDepartment: form.consumer.department,
          consumerProvince: form.consumer.province,
          consumerDistrict: form.consumer.district,
          consumerAddress: form.consumer.address,
          consumerAddressReference: form.consumer.addressReference,
          consumerIsMinor: form.consumer.isMinor,
          guardianFirstName: form.guardian?.firstName ?? null,
          guardianLastName: form.guardian?.lastName ?? null,
          guardianNationalIdType: form.guardian?.nationalIdType ?? null,
          guardianNationalId: form.guardian?.nationalId ?? null,
          goodType: form.goodType,
          amountCents: form.amountCents,
          purchasedOn: form.purchasedOn,
          description: form.description,
          detail: form.detail,
          request: form.request,
          privacyNoticeVersion: complaint.privacyNoticeVersion,
          consumerIp: complaint.ip,
          locale: complaint.locale,
          idempotencyKey: complaint.idempotencyKey,
        })
        // A resend racing the first submit waits on the unique index here and
        // then reads the sheet the first one wrote.
        .onConflictDoNothing({ target: complaints.idempotencyKey })
        .returning({ id: complaints.id, code: complaints.code, filedAt: complaints.createdAt });

      if (!row) {
        const winner = await this.findByKey(tx, complaint.idempotencyKey);
        if (!winner) throw new Error("complaint idempotency conflict without a row");
        return winner;
      }

      await insertOutboxEmails(tx, emails(row));
      return row;
    });
  }

  private async findByKey(
    tx: Pick<Db, "select">,
    idempotencyKey: string,
  ): Promise<FiledComplaint | null> {
    const [row] = await tx
      .select({ id: complaints.id, code: complaints.code, filedAt: complaints.createdAt })
      .from(complaints)
      .where(eq(complaints.idempotencyKey, idempotencyKey))
      .limit(1);
    return row ?? null;
  }
}
