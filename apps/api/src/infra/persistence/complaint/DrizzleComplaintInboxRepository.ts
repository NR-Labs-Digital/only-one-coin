import {
  ComplaintAlreadyAnsweredError,
  ComplaintAlreadyTakenError,
  type ComplaintRecord,
  type EmailNotification,
  type IComplaintInboxRepository,
  type Locale,
} from "@ooc/domain";
import { auditLog, complaintEvents, complaints, students } from "@ooc/db";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { uniqueViolationOf } from "@/infra/persistence/document/DrizzleIssuedDocumentRepository.js";
import { insertOutboxEmails } from "@/infra/persistence/notification/DrizzleOutboxRepository.js";

/**
 * The student file of a sheet (OOC-58): a live file with the consumer's
 * document. The sheet's number was normalized when it was written (OOC-63);
 * a file's may be raw (written before OOC-64), so the file side is
 * normalized here, like the portal's sign-in by document. With duplicates of
 * one person still in the base, the newest file answers.
 */
// Outer columns are qualified by hand: in a one-table select Drizzle writes
// them unqualified, and inside a subquery they would bind to the inner table.
const linkedStudentSql = sql.raw(`(
  select s.id from students s
   where s.deleted_at is null
     and s.national_id_type = "complaints"."consumer_national_id_type"
     and regexp_replace(upper(s.national_id), '[[:space:].-]', '', 'g') = "complaints"."consumer_national_id"
   order by s.created_at desc, s.id desc
   limit 1
)`);

const stepOf = (kind: "taken" | "answered", column: "created_at" | "answer" | "actor_name") => {
  if (column === "actor_name") {
    return sql.raw(`(select u."name" from complaint_events e join "user" u on u.id = e.actor_id where e.complaint_id = "complaints"."id" and e.kind = '${kind}')`) as SQL<string | null>;
  }
  return sql.raw(`(select e.${column} from complaint_events e where e.complaint_id = "complaints"."id" and e.kind = '${kind}')`);
};

const asDate = (value: Date | string | null): Date | null =>
  value === null ? null : value instanceof Date ? value : new Date(value);

/**
 * Reads the book whole (the inbox filters in memory, `ListComplaintsUseCase`)
 * and writes the two steps of a sheet. Every write is the step, its audit
 * entry and — for the answer — the e-mail to the consumer, in one transaction.
 */
export class DrizzleComplaintInboxRepository implements IComplaintInboxRepository {
  constructor(private readonly db: Db) {}

  list(): Promise<ComplaintRecord[]> {
    return this.read();
  }

  async findById(id: string): Promise<ComplaintRecord | null> {
    const [record] = await this.read(eq(complaints.id, id));
    return record ?? null;
  }

  listForStudent(studentId: string): Promise<ComplaintRecord[]> {
    return this.read(sql`${linkedStudentSql} = ${studentId}`);
  }

  async studentExists(studentId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.id, studentId), isNull(students.deletedAt)))
      .limit(1);
    return row !== undefined;
  }

  async take(params: { complaintId: string; actorId: string }): Promise<void> {
    await this.writeStep(params.complaintId, async (tx) => {
      // Answered meanwhile: the step would be a lie about the order.
      const [answered] = await tx
        .select({ id: complaintEvents.id })
        .from(complaintEvents)
        .where(and(eq(complaintEvents.complaintId, params.complaintId), eq(complaintEvents.kind, "answered")))
        .limit(1);
      if (answered) throw new ComplaintAlreadyAnsweredError();
      const [row] = await tx
        .insert(complaintEvents)
        .values({ complaintId: params.complaintId, kind: "taken", actorId: params.actorId })
        .returning({ id: complaintEvents.id });
      await tx.insert(auditLog).values({
        actorId: params.actorId,
        action: "complaint.taken",
        targetId: params.complaintId,
        metadata: { eventId: row!.id },
      });
    });
  }

  async answer(params: {
    complaintId: string;
    actorId: string;
    answer: string;
    emails: EmailNotification[];
  }): Promise<void> {
    await this.writeStep(params.complaintId, async (tx) => {
      const [row] = await tx
        .insert(complaintEvents)
        .values({ complaintId: params.complaintId, kind: "answered", answer: params.answer, actorId: params.actorId })
        .returning({ id: complaintEvents.id });
      await insertOutboxEmails(tx, params.emails);
      // That it was answered, never what: the answer lives in the step.
      await tx.insert(auditLog).values({
        actorId: params.actorId,
        action: "complaint.answered",
        targetId: params.complaintId,
        metadata: { eventId: row!.id },
      });
    });
  }

  /**
   * A step in a transaction. A row lock on the sheet needs UPDATE, which the
   * app role does not hold on an append-only table, so the sheet's steps
   * queue on an advisory lock instead: a take and an answer of the same sheet
   * never race past the answered check. Two of the same step meet at the
   * unique index.
   */
  private async writeStep(complaintId: string, write: (tx: Parameters<Parameters<Db["transaction"]>[0]>[0]) => Promise<void>) {
    try {
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`complaint:${complaintId}`}))`);
        await write(tx);
      });
    } catch (error) {
      if (uniqueViolationOf(error) === "complaint_events_complaint_kind_uidx") {
        const [step] = await this.db
          .select({ kind: complaintEvents.kind })
          .from(complaintEvents)
          .where(and(eq(complaintEvents.complaintId, complaintId), eq(complaintEvents.kind, "answered")))
          .limit(1);
        throw step ? new ComplaintAlreadyAnsweredError() : new ComplaintAlreadyTakenError();
      }
      throw error;
    }
  }

  private async read(where?: SQL): Promise<ComplaintRecord[]> {
    const studentId = linkedStudentSql;
    const rows = await this.db
      .select({
        id: complaints.id,
        code: complaints.code,
        kind: complaints.kind,
        filedAt: complaints.createdAt,
        supplierLegalName: complaints.supplierLegalName,
        supplierRuc: complaints.supplierRuc,
        supplierAddress: complaints.supplierAddress,
        consumerFirstName: complaints.consumerFirstName,
        consumerLastName: complaints.consumerLastName,
        consumerSecondLastName: complaints.consumerSecondLastName,
        consumerNationalIdType: complaints.consumerNationalIdType,
        consumerNationalId: complaints.consumerNationalId,
        consumerPhone: complaints.consumerPhone,
        consumerEmail: complaints.consumerEmail,
        consumerDepartment: complaints.consumerDepartment,
        consumerProvince: complaints.consumerProvince,
        consumerDistrict: complaints.consumerDistrict,
        consumerAddress: complaints.consumerAddress,
        consumerAddressReference: complaints.consumerAddressReference,
        consumerIsMinor: complaints.consumerIsMinor,
        guardianFirstName: complaints.guardianFirstName,
        guardianLastName: complaints.guardianLastName,
        guardianNationalIdType: complaints.guardianNationalIdType,
        guardianNationalId: complaints.guardianNationalId,
        goodType: complaints.goodType,
        amountCents: complaints.amountCents,
        purchasedOn: complaints.purchasedOn,
        description: complaints.description,
        detail: complaints.detail,
        request: complaints.request,
        locale: complaints.locale,
        takenAt: stepOf("taken", "created_at") as SQL<Date | string | null>,
        takenBy: stepOf("taken", "actor_name") as SQL<string | null>,
        answeredAt: stepOf("answered", "created_at") as SQL<Date | string | null>,
        answeredBy: stepOf("answered", "actor_name") as SQL<string | null>,
        answer: stepOf("answered", "answer") as SQL<string | null>,
        studentId: sql<string | null>`${studentId}`,
        studentName: sql<string | null>`(select concat_ws(' ', st.first_name, st.last_name) from students st where st.id = ${studentId})`,
      })
      .from(complaints)
      .where(where)
      .orderBy(desc(complaints.createdAt), desc(complaints.id));

    return rows.map((row): ComplaintRecord => {
      const takenAt = asDate(row.takenAt);
      const answeredAt = asDate(row.answeredAt);
      return {
        id: row.id,
        code: row.code,
        kind: row.kind as ComplaintRecord["kind"],
        filedAt: row.filedAt,
        supplier: { legalName: row.supplierLegalName, ruc: row.supplierRuc, address: row.supplierAddress },
        consumer: {
          firstName: row.consumerFirstName,
          lastName: row.consumerLastName,
          secondLastName: row.consumerSecondLastName,
          nationalIdType: row.consumerNationalIdType as ComplaintRecord["consumer"]["nationalIdType"],
          nationalId: row.consumerNationalId,
          phone: row.consumerPhone,
          email: row.consumerEmail,
          department: row.consumerDepartment,
          province: row.consumerProvince,
          district: row.consumerDistrict,
          address: row.consumerAddress,
          addressReference: row.consumerAddressReference,
          isMinor: row.consumerIsMinor,
        },
        guardian:
          row.guardianFirstName !== null
            ? {
                firstName: row.guardianFirstName,
                lastName: row.guardianLastName!,
                nationalIdType: row.guardianNationalIdType as ComplaintRecord["consumer"]["nationalIdType"],
                nationalId: row.guardianNationalId!,
              }
            : null,
        goodType: row.goodType as ComplaintRecord["goodType"],
        amountCents: row.amountCents,
        purchasedOn: row.purchasedOn,
        description: row.description,
        detail: row.detail,
        request: row.request,
        locale: row.locale as Locale,
        taken: takenAt ? { at: takenAt, actorName: row.takenBy } : null,
        answered: answeredAt ? { at: answeredAt, actorName: row.answeredBy, answer: row.answer ?? "" } : null,
        student: row.studentId && row.studentName ? { studentId: row.studentId, fullName: row.studentName } : null,
      };
    });
  }
}
