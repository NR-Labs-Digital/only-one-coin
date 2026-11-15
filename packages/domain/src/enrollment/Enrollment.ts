// TODO: switch to native crypto.randomUUIDv7() once engines.node requires >=26 (LTS ~out/2026)
import { v7 as uuid } from "uuid";
import { z } from "zod";
import {
  SoftDeletableModel,
  SoftDeletableModelPropsSchema,
} from "../shared/base/SoftDeletableModel.js";
import { EnrollmentOriginSchema, type EnrollmentOrigin } from "./EnrollmentOrigin.js";

export const SeatStatusSchema = z.enum(["reserved", "confirmed", "released"]);
export type SeatStatus = z.infer<typeof SeatStatusSchema>;

export const EnrollmentPropsSchema = SoftDeletableModelPropsSchema.extend({
  studentId: z.string().uuid(),
  classGroupId: z.string().uuid(),
  // Frozen at creation — the plan price in force at the moment of
  // enrollment, never re-resolved afterwards (CLAUDE.md §5).
  planPriceId: z.string().uuid(),
  seatStatus: SeatStatusSchema,
  // Channel attribution (apps/api/CLAUDE.md, "Origem da matrícula") — on the
  // enrollment, not the student: the same person can come back through
  // another channel next cycle.
  origin: EnrollmentOriginSchema,
  // The seat is counted above the class group's capacity (OOC-155), in
  // `seats_over`. Optional so every reader that predates it reads `false`.
  overCapacity: z.boolean().optional(),
});

export type EnrollmentProps = z.infer<typeof EnrollmentPropsSchema>;

export class Enrollment extends SoftDeletableModel {
  public studentId: string;
  public classGroupId: string;
  public planPriceId: string;
  public seatStatus: SeatStatus;
  public origin: EnrollmentOrigin;
  public overCapacity: boolean;

  constructor(props: EnrollmentProps) {
    super(props);
    this.studentId = props.studentId;
    this.classGroupId = props.classGroupId;
    this.planPriceId = props.planPriceId;
    this.seatStatus = props.seatStatus;
    this.origin = props.origin;
    this.overCapacity = props.overCapacity ?? false;
  }

  /**
   * Manual backoffice enrollment (CLAUDE.md §1, lock (c)): the seat is
   * always reserved, never confirmed — confirmation only follows an
   * approved payment, and whoever opens the enrollment does not settle its
   * money.
   *
   * Origin is always `whatsapp`: the manual path exists for the sale that
   * closed on WhatsApp and never reached the form (CLAUDE.md §1).
   */
  static createManual(params: { studentId: string; classGroupId: string; planPriceId: string }): Enrollment {
    return new Enrollment({
      id: uuid(),
      studentId: params.studentId,
      classGroupId: params.classGroupId,
      planPriceId: params.planPriceId,
      seatStatus: "reserved",
      origin: "whatsapp",
    });
  }

  /**
   * Public checkout self-enrollment. Same shape as `createManual` — the seat
   * always starts `reserved`, confirmation only follows an approved payment
   * — kept as its own factory rather than reused so each call site names
   * which flow it belongs to, the way `Payment.createManual` /
   * `createFromPublicCheckout` do.
   *
   * `origin` is the one recorded on the seat hold at first access, never one
   * the submit body claims.
   */
  static createFromPublicCheckout(params: {
    studentId: string;
    classGroupId: string;
    planPriceId: string;
    origin: EnrollmentOrigin;
  }): Enrollment {
    return new Enrollment({
      id: uuid(),
      studentId: params.studentId,
      classGroupId: params.classGroupId,
      planPriceId: params.planPriceId,
      seatStatus: "reserved",
      origin: params.origin,
    });
  }
}
