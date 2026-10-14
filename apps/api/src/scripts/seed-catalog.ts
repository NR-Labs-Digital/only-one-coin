import { academicPeriods, classGroups, courses, planPrices, plans } from "@ooc/db";
import type { LandingCourseKey } from "@ooc/domain";
import { eq } from "drizzle-orm";
import { container } from "@/container.js";

// Real course names, levels, hours and prices — sourced from
// apps/landing/src/i18n/courses-content.ts and ui.ts's `coursePrices`
// (origin/main, "feat(landing): real course programmes"), not invented for
// this seed. `amountCents: null` mirrors the landing's own `coursePrices`
// null: coordination has not set a price for that level yet, so no plan/
// price/class group is created for it — it exists as a course, same as the
// landing shows the page with no price rather than inventing one
// (CLAUDE.md §9). Schedule, teacher and class group code ARE placeholders:
// unlike the course content, nobody has given real ones yet.
interface SeedCourse {
  name: string;
  language: string;
  level: string;
  modules: number;
  totalHours: number;
  amountCents: number | null;
  /** The landing page that links here (OOC-117), so local/staging prefill works out of the box. */
  landingKey: LandingCourseKey;
}

const SEED_COURSES: SeedCourse[] = [
  { name: "Inglés", landingKey: "english", language: "Inglés", level: "Básico (A1–A2)", modules: 4, totalHours: 80, amountCents: 6990 },
  { name: "Inglés — Cambridge B1", landingKey: "cambridge-b1", language: "Inglés", level: "Intermedio (B1)", modules: 4, totalHours: 0, amountCents: null },
  { name: "Francés", landingKey: "french", language: "Francés", level: "Básico (A1)", modules: 4, totalHours: 80, amountCents: 8000 },
  { name: "Francés — Avanzado", landingKey: "french-advanced", language: "Francés", level: "Intermedio / Avanzado (B1–B2 aprox.)", modules: 4, totalHours: 0, amountCents: null },
  { name: "Italiano", landingKey: "italian", language: "Italiano", level: "Básico inicial (A1)", modules: 6, totalHours: 60, amountCents: 8000 },
  { name: "Alemán", landingKey: "german", language: "Alemán", level: "Introductorio (A1 inicial)", modules: 4, totalHours: 16, amountCents: 3000 },
  { name: "Portugués", landingKey: "portuguese", language: "Portugués", level: "Básico (A1–A2 inicial)", modules: 4, totalHours: 80, amountCents: 8000 },
  { name: "Chino Mandarín", landingKey: "mandarin-chinese", language: "Chino Mandarín", level: "Básico inicial (HSK 1 aprox.)", modules: 5, totalHours: 60, amountCents: 9500 },
  { name: "Coreano", landingKey: "korean", language: "Coreano", level: "Básico a A2 (intermedio inicial)", modules: 10, totalHours: 0, amountCents: 6000 },
];

// Rotated across courses only for visual variety in the picker — same
// caveat as the schedule/teacher fields above.
const SLOT_PATTERNS = [
  { schedule: "Lun/Mié 18:00-19:00", slots: [{ weekday: "mon", startTime: "18:00", endTime: "19:00" }, { weekday: "wed", startTime: "18:00", endTime: "19:00" }] },
  { schedule: "Mar/Jue 18:00-19:00", slots: [{ weekday: "tue", startTime: "18:00", endTime: "19:00" }, { weekday: "thu", startTime: "18:00", endTime: "19:00" }] },
  { schedule: "Lun-Vie 07:00-08:00", slots: [{ weekday: "mon", startTime: "07:00", endTime: "08:00" }, { weekday: "tue", startTime: "07:00", endTime: "08:00" }, { weekday: "wed", startTime: "07:00", endTime: "08:00" }, { weekday: "thu", startTime: "07:00", endTime: "08:00" }, { weekday: "fri", startTime: "07:00", endTime: "08:00" }] },
];

async function main() {
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 3);

  let [period] = await container.db.select().from(academicPeriods).where(eq(academicPeriods.name, "Ciclo de prueba (seed)"));
  if (!period) {
    [period] = await container.db
      .insert(academicPeriods)
      .values({ name: "Ciclo de prueba (seed)", startsOn: now, endsOn: periodEnd })
      .returning();
  }

  for (const [index, seedCourse] of SEED_COURSES.entries()) {
    const [existing] = await container.db.select().from(courses).where(eq(courses.name, seedCourse.name));
    if (existing) {
      console.log(`${seedCourse.name} already seeded, skipping`);
      continue;
    }

    const [course] = await container.db
      .insert(courses)
      .values({
        name: seedCourse.name,
        language: seedCourse.language,
        // No age floor in the landing content either — REGRAS-NEGOCIO.md §2's
        // "13 for everything else" (no kids track among these nine).
        minAge: 13,
        level: seedCourse.level,
        modules: seedCourse.modules,
        totalHours: seedCourse.totalHours,
        landingKey: seedCourse.landingKey,
      })
      .returning();

    if (seedCourse.amountCents === null) {
      console.log(`Seeded course "${course!.name}" — no price yet, no class group`);
      continue;
    }

    const [plan] = await container.db
      .insert(plans)
      .values({ courseId: course!.id, name: "Paquete completo" })
      .returning();

    const [price] = await container.db
      .insert(planPrices)
      .values({ planId: plan!.id, amountCents: seedCourse.amountCents, validFrom: now })
      .returning();

    const pattern = SLOT_PATTERNS[index % SLOT_PATTERNS.length]!;
    const classStart = new Date(now);
    classStart.setDate(classStart.getDate() + 7 + index);
    const classEnd = new Date(classStart);
    classEnd.setMonth(classEnd.getMonth() + 2);

    const [classGroup] = await container.db
      .insert(classGroups)
      .values({
        courseId: course!.id,
        academicPeriodId: period!.id,
        schedule: pattern.schedule,
        slots: pattern.slots,
        code: `${course!.id.slice(0, 8)}-01`,
        teacherName: "Docente por asignar (seed)",
        startsOn: classStart,
        endsOn: classEnd,
        capacity: 20,
        status: "enrolling",
      })
      .returning();

    console.log(
      `Seeded course "${course!.name}", plan "${plan!.name}" (S/${(price!.amountCents / 100).toFixed(2)}), class group ${classGroup!.id}`,
    );
  }

  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
