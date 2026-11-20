import { v7 as uuid } from "uuid";
import { z } from "zod";
import { BaseModel, BaseModelPropsSchema } from "../shared/base/BaseModel.js";
import { SoftDeletableModel, SoftDeletableModelPropsSchema } from "../shared/base/SoftDeletableModel.js";
import { PriceInPastError } from "./errors.js";

/**
 * How far behind "now" a price may claim to start and still count as now: the
 * screen sends its own clock, and a form submitted a few seconds after it was
 * rendered must not be refused as "in the past".
 */
export const PRICE_PAST_TOLERANCE_MS = 60_000;

/**
 * How a plan is paid (OOC-86, CLAUDE.md §1). `package` is one payment for the
 * whole plan. `monthly` is a prepaid purchase of one module at a time — never
 * an installment of the package, never a debt — and the plan's price is the
 * price of one module. A property of the plan, never of the language.
 */
export const PLAN_BILLINGS = ["package", "monthly"] as const;
export type PlanBilling = (typeof PLAN_BILLINGS)[number];
export const PlanBillingSchema = z.enum(PLAN_BILLINGS);

export const PlanPropsSchema = SoftDeletableModelPropsSchema.extend({
  courseId: z.string().uuid(),
  name: z.string().trim().min(1),
  billing: PlanBillingSchema.default("package"),
});

export type PlanProps = z.infer<typeof PlanPropsSchema>;

/** A way of buying a course ("Paquete completo", "Mensual"). Price lives apart. */
export class Plan extends SoftDeletableModel {
  public readonly courseId: string;
  public name: string;
  /** Fixed at creation: what a payment of this plan bought must not change meaning later. */
  public readonly billing: PlanBilling;

  constructor(props: PlanProps) {
    super(props);
    this.courseId = props.courseId;
    this.name = props.name;
    this.billing = props.billing;
  }

  static create(dto: { courseId: string; name: string; billing?: PlanBilling }): Plan {
    return new Plan(PlanPropsSchema.parse({ ...dto, id: uuid() }));
  }

  /** Answers whether the name actually changed. */
  rename(name: string): boolean {
    const next = PlanPropsSchema.shape.name.parse(name);
    if (next === this.name) return false;
    this.name = next;
    this.touch();
    return true;
  }
}

export const PlanPricePropsSchema = BaseModelPropsSchema.extend({
  planId: z.string().min(1),
  amountCents: z.number().int().positive(),
  validFrom: z.coerce.date(),
});

export type PlanPriceProps = z.infer<typeof PlanPricePropsSchema>;

/**
 * One version of a plan's price. Append-only — no setter, no update: a new
 * price is a new row, and migration 0017 makes Postgres refuse the rest. The
 * price in force on a date is the greatest validFrom not after it.
 */
export class PlanPrice extends BaseModel {
  public readonly planId: string;
  public readonly amountCents: number;
  public readonly validFrom: Date;

  constructor(props: PlanPriceProps) {
    super(props);
    this.planId = props.planId;
    this.amountCents = props.amountCents;
    this.validFrom = props.validFrom;
  }

  static schedule(
    dto: { planId: string; amountCents: number; validFrom?: Date },
    now: Date = new Date(),
  ): PlanPrice {
    const validFrom = dto.validFrom ?? now;

    // Backdating a price would reprice enrollments that already froze the old
    // one in every report that asks "what did this cost on date X".
    if (validFrom.getTime() < now.getTime() - PRICE_PAST_TOLERANCE_MS) {
      throw new PriceInPastError();
    }

    return new PlanPrice(PlanPricePropsSchema.parse({ ...dto, validFrom, id: uuid() }));
  }
}
