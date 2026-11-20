import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import { CourseNotFoundError } from "./errors.js";
import { Plan, PlanPrice, type PlanBilling } from "./Plan.js";
import type { ICourseRepository } from "./ports/ICourseRepository.js";
import type { IPlanRepository } from "./ports/IPlanRepository.js";

export interface CreatePlanInput {
  actorId: string;
  courseId: string;
  name: string;
  /** Omitted = package. Monthly makes `amountCents` the price of one module (OOC-86). */
  billing?: PlanBilling;
  amountCents: number;
  validFrom?: Date;
}

/** A plan is born with its first price — there is no sellable plan without one. */
export class CreatePlanUseCase extends BaseUseCase<CreatePlanInput, { plan: Plan; price: PlanPrice }> {
  constructor(
    private readonly courses: ICourseRepository,
    private readonly plans: IPlanRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: CreatePlanInput): Promise<{ plan: Plan; price: PlanPrice }> {
    const course = await this.courses.findById(input.courseId);
    if (!course || course.isDeleted) throw new CourseNotFoundError();

    const plan = Plan.create({ courseId: course.id, name: input.name, billing: input.billing });
    const price = PlanPrice.schedule({ planId: plan.id, amountCents: input.amountCents, validFrom: input.validFrom });

    await this.plans.createWithPrice(plan, price);

    await this.auditLog.append({
      actorId: input.actorId,
      action: "catalog.plan.created",
      targetId: plan.id,
      metadata: { courseId: course.id, billing: plan.billing, amountCents: price.amountCents, validFrom: price.validFrom.toISOString() },
      at: plan.createdAt,
    });

    return { plan, price };
  }
}
