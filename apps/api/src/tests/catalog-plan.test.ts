import {
  Course,
  CourseNotFoundError,
  CreatePlanUseCase,
  Plan,
  PlanNotFoundError,
  PlanPrice,
  PriceInPastError,
  RenamePlanUseCase,
  SchedulePlanPriceUseCase,
} from "@ooc/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeAuditLogRepository, FakeCourseRepository, FakePlanRepository } from "./fakes/catalog.js";

/**
 * Plans and their versioned prices (CLAUDE.md §1 "sem descontos", apps/api
 * CLAUDE.md "preço é versionado, nunca editado"). A new price is always a new
 * row; a price may start now or later, never earlier.
 */

const ACTOR = "usr_admin";
const DAY = 24 * 60 * 60 * 1000;

let courses: FakeCourseRepository;
let plans: FakePlanRepository;
let auditLog: FakeAuditLogRepository;
let course: Course;

beforeEach(async () => {
  courses = new FakeCourseRepository();
  plans = new FakePlanRepository();
  auditLog = new FakeAuditLogRepository();
  course = await courses.create(
    Course.create({
      name: "Francés",
      language: "Francés",
      level: "A1",
      summary: "Francés para principiantes.",
      minAge: 13,
      modules: 4, moduleMaterials: Array(4).fill("https://drive.google.com/x"),
      totalHours: 80,
      certificateRule: "automatic",
      allowsFreeze: true,
      allowsTransfer: false,
    }),
  );
});

describe("PlanPrice.schedule", () => {
  it("defaults validFrom to now", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    expect(PlanPrice.schedule({ planId: "p", amountCents: 8000 }, now).validFrom).toEqual(now);
  });

  it("accepts a future date", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    const later = new Date(now.getTime() + 30 * DAY);
    expect(PlanPrice.schedule({ planId: "p", amountCents: 8000, validFrom: later }, now).validFrom).toEqual(later);
  });

  it("tolerates a few seconds of clock skew", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    const skewed = new Date(now.getTime() - 5_000);
    expect(() => PlanPrice.schedule({ planId: "p", amountCents: 8000, validFrom: skewed }, now)).not.toThrow();
  });

  it("refuses a date in the past", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    expect(() =>
      PlanPrice.schedule({ planId: "p", amountCents: 8000, validFrom: new Date(now.getTime() - DAY) }, now),
    ).toThrow(PriceInPastError);
  });

  it("refuses a non-positive or fractional amount", () => {
    expect(() => PlanPrice.schedule({ planId: "p", amountCents: 0 })).toThrow();
    expect(() => PlanPrice.schedule({ planId: "p", amountCents: 10.5 })).toThrow();
  });
});

describe("CreatePlanUseCase", () => {
  it("creates the plan with its first price and audits it", async () => {
    const result = await new CreatePlanUseCase(courses, plans, auditLog).run({
      actorId: ACTOR,
      courseId: course.id,
      name: "Paquete completo",
      amountCents: 8000,
    });

    expect(result.plan.courseId).toBe(course.id);
    expect(plans.prices).toEqual([result.price]);
    expect(auditLog.appended.map((entry) => entry.action)).toEqual(["catalog.plan.created"]);
  });

  it("refuses a retired course", async () => {
    course.softDelete();
    await expect(
      new CreatePlanUseCase(courses, plans, auditLog).run({ actorId: ACTOR, courseId: course.id, name: "X", amountCents: 100 }),
    ).rejects.toBeInstanceOf(CourseNotFoundError);
  });
});

describe("SchedulePlanPriceUseCase", () => {
  it("adds a new price row and never touches the old one", async () => {
    const { plan, price: first } = await new CreatePlanUseCase(courses, plans, auditLog).run({
      actorId: ACTOR,
      courseId: course.id,
      name: "Paquete completo",
      amountCents: 8000,
    });

    const next = await new SchedulePlanPriceUseCase(plans, auditLog).run({
      actorId: ACTOR,
      planId: plan.id,
      amountCents: 9000,
      validFrom: new Date(Date.now() + 7 * DAY),
    });

    expect(plans.prices).toEqual([first, next]);
    expect(first.amountCents).toBe(8000);
    expect(auditLog.appended.at(-1)).toEqual(
      expect.objectContaining({ action: "catalog.plan_price.scheduled", targetId: plan.id }),
    );
  });

  it("answers 404 for a retired plan", async () => {
    const plan = Plan.create({ courseId: course.id, name: "Viejo" });
    plan.softDelete();
    plans.plans.set(plan.id, plan);

    await expect(
      new SchedulePlanPriceUseCase(plans, auditLog).run({ actorId: ACTOR, planId: plan.id, amountCents: 100 }),
    ).rejects.toBeInstanceOf(PlanNotFoundError);
  });
});

describe("RenamePlanUseCase", () => {
  it("renames and audits; a same-name rename writes nothing", async () => {
    const plan = Plan.create({ courseId: course.id, name: "Mensual" });
    plans.plans.set(plan.id, plan);
    const rename = new RenamePlanUseCase(plans, auditLog);

    await rename.run({ actorId: ACTOR, id: plan.id, name: "Mensual" });
    expect(auditLog.appended).toEqual([]);

    await rename.run({ actorId: ACTOR, id: plan.id, name: "Mensualidad" });
    expect(plans.plans.get(plan.id)?.name).toBe("Mensualidad");
    expect(auditLog.appended.map((entry) => entry.action)).toEqual(["catalog.plan.renamed"]);
  });
});
