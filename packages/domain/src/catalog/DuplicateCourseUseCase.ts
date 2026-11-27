import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import { Course, type CreateCourseDTO } from "./Course.js";
import { CourseCopyNameUnchangedError, CourseNotFoundError, LanguageNotFoundError, PlanNotFoundError } from "./errors.js";
import { Plan, PlanPrice } from "./Plan.js";
import type { ICourseRepository } from "./ports/ICourseRepository.js";
import type { ILanguageRepository } from "./ports/ILanguageRepository.js";
import type { IPlanRepository } from "./ports/IPlanRepository.js";
import { languageKey } from "./courseLanguage.js";

export interface DuplicatedPlanInput {
  /** The plan being copied: its billing comes along and stays fixed (OOC-86). */
  sourcePlanId: string;
  name: string;
  /** The copy's first price — the source's price in force is only where the form starts. */
  amountCents: number;
}

export interface DuplicateCourseInput {
  actorId: string;
  sourceCourseId: string;
  /** The new course, as the form left it. No landing page: one live course per page (OOC-117). */
  course: Omit<CreateCourseDTO, "language" | "languageId" | "landingKey"> & { languageId: string };
  plans: readonly DuplicatedPlanInput[];
}

/**
 * Opens a course from another one (OOC-182) — the same act as creating a
 * course, started from a filled-in form instead of a blank one. What the form
 * sends is the new course: the source only decides which plans may be copied
 * and with which billing, and is never written.
 *
 * Class groups, enrollments, grades and the landing page stay with the
 * source. Each copied plan starts with the price the person typed, in force
 * now — no discount exists, the price is whatever was saved.
 */
export class DuplicateCourseUseCase extends BaseUseCase<DuplicateCourseInput, Course> {
  constructor(
    private readonly courses: ICourseRepository,
    private readonly plans: IPlanRepository,
    private readonly languages: ILanguageRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: DuplicateCourseInput): Promise<Course> {
    const source = await this.courses.findById(input.sourceCourseId);
    if (!source) throw new CourseNotFoundError();

    const language = await this.languages.findById(input.course.languageId);
    if (!language || language.isDeleted) throw new LanguageNotFoundError();

    const course = Course.create({ ...input.course, language: language.name, landingKey: null });
    // Compared the way language names are (case, accents, stray spaces): "Inglés A1 " is not a new name.
    if (languageKey(course.name) === languageKey(source.name)) throw new CourseCopyNameUnchangedError();

    const sourcePlans = new Map(
      (await this.plans.listByCourse(source.id)).filter((plan) => !plan.isDeleted).map((plan) => [plan.id, plan]),
    );
    const seen = new Set<string>();
    const copies = input.plans.map((item) => {
      const origin = sourcePlans.get(item.sourcePlanId);
      if (!origin || seen.has(origin.id)) throw new PlanNotFoundError();
      seen.add(origin.id);
      const plan = Plan.create({ courseId: course.id, name: item.name, billing: origin.billing });
      const price = PlanPrice.schedule({ planId: plan.id, amountCents: item.amountCents });
      return { plan, price, sourcePlanId: origin.id };
    });

    const created = await this.courses.createWithPlans(course, copies);

    await this.auditLog.append({
      actorId: input.actorId,
      action: "catalog.course.duplicated",
      targetId: created.id,
      metadata: { sourceCourseId: source.id, name: created.name, language: created.language, plans: copies.length },
      at: created.createdAt,
    });
    for (const { plan, price, sourcePlanId } of copies) {
      await this.auditLog.append({
        actorId: input.actorId,
        action: "catalog.plan.created",
        targetId: plan.id,
        metadata: {
          courseId: created.id,
          sourcePlanId,
          billing: plan.billing,
          amountCents: price.amountCents,
          validFrom: price.validFrom.toISOString(),
        },
        at: plan.createdAt,
      });
    }

    return created;
  }
}
