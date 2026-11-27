import {
  Course,
  CourseCopyNameUnchangedError,
  DuplicateCourseUseCase,
  Language,
  LanguageNotFoundError,
  Plan,
  PlanNotFoundError,
  PlanPrice,
  CourseNotFoundError,
} from "@ooc/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  FakeAuditLogRepository,
  FakeCourseRepository,
  FakeLanguageRepository,
  FakePlanRepository,
} from "./fakes/catalog.js";

/**
 * Duplicating a course (OOC-182). Pure domain — fakes, no database. What
 * matters: the copy is a new course with new plans, the billing comes from
 * the source plan, the landing page never comes along, the source is never
 * written, and the audit points back at it.
 */

const ACTOR = "usr_admin";
const LINKS = ["https://drive.google.com/drive/folders/m1", "https://drive.google.com/drive/folders/m2"];

let courses: FakeCourseRepository;
let plans: FakePlanRepository;
let languages: FakeLanguageRepository;
let auditLog: FakeAuditLogRepository;
let english: Language;
let source: Course;
let packagePlan: Plan;
let monthlyPlan: Plan;

beforeEach(async () => {
  courses = new FakeCourseRepository();
  plans = new FakePlanRepository();
  courses.planSink = plans;
  languages = new FakeLanguageRepository();
  auditLog = new FakeAuditLogRepository();
  english = Language.create("Inglés");
  await languages.create(english);

  source = Course.create({
    name: "Inglés Kids A1",
    language: english.name,
    languageId: english.id,
    level: "A1",
    minAge: 7,
    modules: 2,
    moduleMaterials: LINKS,
    totalHours: 40,
    certificateRule: "automatic",
    allowsFreeze: true,
    allowsTransfer: false,
    landingKey: "english-kids",
  });
  await courses.create(source);
  packagePlan = Plan.create({ courseId: source.id, name: "Paquete completo" });
  monthlyPlan = Plan.create({ courseId: source.id, name: "Mensual", billing: "monthly" });
  await plans.createWithPrice(packagePlan, PlanPrice.schedule({ planId: packagePlan.id, amountCents: 20000 }));
  await plans.createWithPrice(monthlyPlan, PlanPrice.schedule({ planId: monthlyPlan.id, amountCents: 6000 }));
});

const useCase = () => new DuplicateCourseUseCase(courses, plans, languages, auditLog);

const copy = (extra: { name?: string } = {}) => ({
  name: extra.name ?? "Inglés Kids A2",
  languageId: english.id,
  level: "A2",
  minAge: 7,
  modules: 2,
  moduleMaterials: LINKS,
  totalHours: 40,
  certificateRule: "automatic" as const,
  allowsFreeze: true,
  allowsTransfer: false,
});

describe("DuplicateCourseUseCase", () => {
  it("opens a new course with copies of the plans, at the prices typed, without the landing page", async () => {
    const created = await useCase().run({
      actorId: ACTOR,
      sourceCourseId: source.id,
      course: copy(),
      plans: [
        { sourcePlanId: packagePlan.id, name: "Paquete completo", amountCents: 22000 },
        // The person cannot change the billing: it rides on the source plan.
        { sourcePlanId: monthlyPlan.id, name: "Mensual", amountCents: 6500 },
      ],
    });

    expect(created.id).not.toBe(source.id);
    expect(created.name).toBe("Inglés Kids A2");
    expect(created.landingKey).toBeNull();
    expect(source.landingKey).toBe("english-kids");

    const copied = await plans.listByCourse(created.id);
    expect(copied.map((plan) => [plan.name, plan.billing])).toEqual([
      ["Paquete completo", "package"],
      ["Mensual", "monthly"],
    ]);
    const prices = plans.prices.filter((price) => copied.some((plan) => plan.id === price.planId));
    expect(prices.map((price) => price.amountCents)).toEqual([22000, 6500]);
    // The source's plans keep their own single price.
    expect(plans.prices.filter((price) => price.planId === packagePlan.id).map((p) => p.amountCents)).toEqual([20000]);

    expect(auditLog.appended[0]).toEqual(
      expect.objectContaining({
        action: "catalog.course.duplicated",
        targetId: created.id,
        metadata: expect.objectContaining({ sourceCourseId: source.id, plans: 2 }),
      }),
    );
    expect(auditLog.appended.filter((entry) => entry.action === "catalog.plan.created")).toHaveLength(2);
  });

  it("copies no plan the person left out", async () => {
    const created = await useCase().run({ actorId: ACTOR, sourceCourseId: source.id, course: copy(), plans: [] });
    expect(await plans.listByCourse(created.id)).toEqual([]);
  });

  it("refuses the source's own name, however it is cased or spaced", async () => {
    await expect(
      useCase().run({ actorId: ACTOR, sourceCourseId: source.id, course: copy({ name: " inglés kids a1 " }), plans: [] }),
    ).rejects.toBeInstanceOf(CourseCopyNameUnchangedError);
    expect(courses.rows.size).toBe(1);
  });

  it("refuses a plan of another course, a retired plan, or the same plan twice", async () => {
    const stranger = Plan.create({ courseId: "018f2b5c-0000-7000-8000-000000000009", name: "Otro" });
    await plans.createWithPrice(stranger, PlanPrice.schedule({ planId: stranger.id, amountCents: 1000 }));
    monthlyPlan.softDelete();

    for (const list of [
      [{ sourcePlanId: stranger.id, name: "Otro", amountCents: 1000 }],
      [{ sourcePlanId: monthlyPlan.id, name: "Mensual", amountCents: 6000 }],
      [
        { sourcePlanId: packagePlan.id, name: "A", amountCents: 1000 },
        { sourcePlanId: packagePlan.id, name: "B", amountCents: 1000 },
      ],
    ]) {
      await expect(
        useCase().run({ actorId: ACTOR, sourceCourseId: source.id, course: copy(), plans: list }),
      ).rejects.toBeInstanceOf(PlanNotFoundError);
    }
    expect(courses.rows.size).toBe(1);
    expect(auditLog.appended).toEqual([]);
  });

  it("refuses an unknown source or a language not on the list", async () => {
    await expect(
      useCase().run({ actorId: ACTOR, sourceCourseId: "018f2b5c-0000-7000-8000-00000000000a", course: copy(), plans: [] }),
    ).rejects.toBeInstanceOf(CourseNotFoundError);

    const other = Language.create("Francés");
    await expect(
      useCase().run({ actorId: ACTOR, sourceCourseId: source.id, course: { ...copy(), languageId: other.id }, plans: [] }),
    ).rejects.toBeInstanceOf(LanguageNotFoundError);
  });
});
