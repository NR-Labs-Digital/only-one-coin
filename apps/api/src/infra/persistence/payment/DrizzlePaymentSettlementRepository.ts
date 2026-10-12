import {
  PaymentAlreadySettledError,
  PaymentSeatReleasedError,
  type IPaymentSettlementRepository,
  type PortalAccessOutcome,
  type PaymentStatus,
  type PaymentToSettle,
  type SeatStatus,
} from "@ooc/domain";
import { auditLog, classGroups, enrollments, payments } from "@ooc/db";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { provisionPortalAccount } from "@/infra/persistence/portal/provisionPortalAccount.js";
import { insertOutboxEmails } from "@/infra/persistence/notification/DrizzleOutboxRepository.js";

const OPEN: PaymentStatus[] = ["pending", "under_review"];

export class DrizzlePaymentSettlementRepository implements IPaymentSettlementRepository {
  constructor(private readonly db: Db) {}

  async findForSettlement(paymentId: string): Promise<PaymentToSettle | null> {
    const [row] = await this.db
      .select({
        paymentId: payments.id,
        enrollmentId: enrollments.id,
        studentId: enrollments.studentId,
        classGroupId: enrollments.classGroupId,
        status: payments.status,
        seatStatus: enrollments.seatStatus,
      })
      .from(payments)
      .innerJoin(enrollments, eq(enrollments.id, payments.enrollmentId))
      .where(eq(payments.id, paymentId));

    return row ? { ...row, status: row.status as PaymentStatus, seatStatus: row.seatStatus as SeatStatus } : null;
  }

  async settle(params: Parameters<IPaymentSettlementRepository["settle"]>[0]): Promise<{ seatStatus: SeatStatus; portalAccess: PortalAccessOutcome | null }> {
    return this.db.transaction(async (tx) => {
      // The guard against two reviewers (or one double click): the payment
      // only moves out of an open state, and Postgres serialises the two
      // UPDATEs on the row lock — the second sees the first's status.
      const [moved] = await tx
        .update(payments)
        .set({
          status: params.to,
          decidedAt: params.decision.at,
          decidedBy: params.decision.by,
          rejectionReason: params.decision.rejectionReason,
          updatedAt: sql`now()`,
        })
        .where(and(eq(payments.id, params.paymentId), inArray(payments.status, OPEN)))
        .returning({ id: payments.id });
      if (!moved) throw new PaymentAlreadySettledError();

      const seatStatus = params.to === "approved" ? await this.confirmSeat(tx, params) : await this.releaseSeat(tx, params);

      await insertOutboxEmails(tx, params.notifications);
      await tx.insert(auditLog).values({
        actorId: params.audit.actorId,
        action: params.audit.action,
        targetId: params.audit.targetId,
        metadata: params.audit.metadata ?? null,
        createdAt: params.audit.at,
      });

      const portalAccess = params.portalAccess ? await provisionPortalAccount(tx, params.portalAccess) : null;

      return { seatStatus, portalAccess };
    });
  }

  /** reserved → confirmed. Already confirmed (a monthly module) stays; released refuses. */
  private async confirmSeat(tx: Tx, params: { enrollmentId: string }): Promise<SeatStatus> {
    const [confirmed] = await tx
      .update(enrollments)
      .set({ seatStatus: "confirmed", updatedAt: sql`now()` })
      .where(and(eq(enrollments.id, params.enrollmentId), eq(enrollments.seatStatus, "reserved")))
      .returning({ id: enrollments.id });
    if (confirmed) return "confirmed";

    const current = await this.currentSeat(tx, params.enrollmentId);
    if (current !== "confirmed") throw new PaymentSeatReleasedError();
    return current;
  }

  /** reserved → released, and the seat goes back to the class group in the same
   * transaction. Any other seat is left as it is. */
  private async releaseSeat(tx: Tx, params: { enrollmentId: string; classGroupId: string }): Promise<SeatStatus> {
    const [released] = await tx
      .update(enrollments)
      .set({ seatStatus: "released", updatedAt: sql`now()` })
      .where(and(eq(enrollments.id, params.enrollmentId), eq(enrollments.seatStatus, "reserved")))
      .returning({ id: enrollments.id });
    if (!released) return this.currentSeat(tx, params.enrollmentId);

    await tx
      .update(classGroups)
      .set({ seatsTaken: sql`${classGroups.seatsTaken} - 1` })
      .where(and(eq(classGroups.id, params.classGroupId), gt(classGroups.seatsTaken, 0)));
    return "released";
  }

  private async currentSeat(tx: Tx, enrollmentId: string): Promise<SeatStatus> {
    const [row] = await tx
      .select({ seatStatus: enrollments.seatStatus })
      .from(enrollments)
      .where(eq(enrollments.id, enrollmentId));
    return row!.seatStatus as SeatStatus;
  }
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
