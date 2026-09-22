// TODO: switch to native crypto.randomUUIDv7() once engines.node requires >=26 (LTS ~out/2026)
import { v7 as uuid } from "uuid";
import { z } from "zod";
import { BaseModel, BaseModelPropsSchema } from "../shared/base/BaseModel.js";

export const PaymentRailSchema = z.enum(["yape", "plin", "bcp", "interbank"]);
export const PaymentMethodSchema = z.union([PaymentRailSchema, z.literal("other")]);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const PaymentStatusSchema = z.enum(["pending", "under_review", "approved", "rejected"]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const PaymentPropsSchema = BaseModelPropsSchema
  .extend({
    enrollmentId: z.string().uuid(),
    idempotencyKey: z.string().min(1),
    status: PaymentStatusSchema,
    method: PaymentMethodSchema,
    // Required only when method is 'other' — the free text IS the label
    // (CLAUDE.md §4 glossary).
    methodDetail: z.string().min(1).nullable(),
    amountCents: z.number().int().positive(),
    operationNumber: z.string().min(1).nullable(),
  })
  .refine((props) => props.method !== "other" || props.methodDetail !== null, {
    message: "methodDetail is required when method is 'other'",
    path: ["methodDetail"],
  });

export type PaymentProps = z.infer<typeof PaymentPropsSchema>;

export class Payment extends BaseModel {
  public enrollmentId: string;
  public idempotencyKey: string;
  public status: PaymentStatus;
  public method: PaymentMethod;
  public methodDetail: string | null;
  public amountCents: number;
  public operationNumber: string | null;

  constructor(props: PaymentProps) {
    super(props);
    this.enrollmentId = props.enrollmentId;
    this.idempotencyKey = props.idempotencyKey;
    this.status = props.status;
    this.method = props.method;
    this.methodDetail = props.methodDetail;
    this.amountCents = props.amountCents;
    this.operationNumber = props.operationNumber;
  }

  /**
   * Manual backoffice enrollment (CLAUDE.md §1, lock (d)): the payment never
   * starts approved. With a receipt attached it enters the same review
   * ladder every other receipt does (`under_review`); without one it is
   * still `pending` on the student sending it — mirroring
   * apps/app/.../new-enrollment-form.tsx's own submit logic.
   */
  static createManual(params: {
    enrollmentId: string;
    method: PaymentMethod;
    methodDetail: string | null;
    amountCents: number;
    operationNumber: string;
    receiptAttached: boolean;
  }): Payment {
    const result = PaymentPropsSchema.safeParse({
      id: uuid(),
      enrollmentId: params.enrollmentId,
      idempotencyKey: uuid(),
      status: params.receiptAttached ? "under_review" : "pending",
      method: params.method,
      methodDetail: params.methodDetail,
      amountCents: params.amountCents,
      operationNumber: params.operationNumber,
    });

    if (!result.success) {
      throw new Error("Invalid data");
    }

    return new Payment(result.data);
  }

  /**
   * Public checkout self-enrollment. Always `pending`, never `under_review`:
   * CLAUDE.md §5's OCR ladder is what moves a payment out of `pending`, and
   * this reduced slice does not run it yet (no upload, no worker) — a
   * receipt the student describes but this never stores. `idempotencyKey`
   * comes from the client, generated once per submit attempt and resent
   * unchanged on retry (CLAUDE.md §5, "duplo POST de celular ruim é
   * certeza") — unlike `createManual`, which mints its own because staff
   * retrying a click is not the same risk as a flaky mobile connection.
   */
  static createFromPublicCheckout(params: {
    enrollmentId: string;
    idempotencyKey: string;
    method: PaymentMethod;
    methodDetail: string | null;
    amountCents: number;
    operationNumber: string;
  }): Payment {
    const result = PaymentPropsSchema.safeParse({
      id: uuid(),
      enrollmentId: params.enrollmentId,
      idempotencyKey: params.idempotencyKey,
      status: "pending",
      method: params.method,
      methodDetail: params.methodDetail,
      amountCents: params.amountCents,
      operationNumber: params.operationNumber,
    });

    if (!result.success) {
      throw new Error("Invalid data");
    }

    return new Payment(result.data);
  }
}
