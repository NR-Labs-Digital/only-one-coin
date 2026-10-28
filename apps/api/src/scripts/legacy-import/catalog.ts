import { academicPeriods, classGroups, courses, planPrices, plans } from "@ooc/db";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { languageFor } from "@/infra/persistence/catalog/DrizzleLanguageRepository.js";
import type { LegacyRecord, Modality } from "./assemble.js";

interface CatalogLookups {
  classGroupIdByKey: Map<string, string>;
  planIdByKey: Map<string, string>;
}

function normalizeWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, " ").toUpperCase();
}

export function classGroupKey(record: LegacyRecord): string {
  return `${record.courseKey}|${record.startsOn.toISOString().slice(0, 10)}|${normalizeWhitespace(record.scheduleText)}`;
}

function planKey(courseKey: string, modality: Modality): string {
  return `${courseKey}|${modality}`;
}

// minAge is intentionally a placeholder (courses check only requires > 0):
// the legacy sheets don't record a minimum age per course, and CLAUDE.md §9
// says not to invent a business rule like this — the real floor per course
// needs the same confirmation any other course fact gets before it governs
// anything (this bypass-import never validates it against birth_date). Flag
// left here on purpose rather than guessing 6/13/18 confidently.
const PLACEHOLDER_MIN_AGE = 1;

const MODALITY_PLAN_NAME: Record<Modality, string> = {
  paquete: "Paquete completo",
  mensual: "Mensual (por módulo)",
};

async function upsertCourse(db: Db, courseKey: string, courseName: string, language: string): Promise<string> {
  const [existing] = await db.select().from(courses).where(eq(courses.name, courseName));
  if (existing) return existing.id;
  const filed = await languageFor(db, language);
  const [created] = await db
    .insert(courses)
    .values({ name: courseName, language: filed.name, languageId: filed.id, minAge: PLACEHOLDER_MIN_AGE })
    .returning();
  console.log(`  [catalog] course created: ${courseName}`);
  return created!.id;
}

async function upsertPlan(db: Db, courseId: string, modality: Modality): Promise<string> {
  const name = MODALITY_PLAN_NAME[modality];
  const [existing] = await db.select().from(plans).where(and(eq(plans.courseId, courseId), eq(plans.name, name)));
  if (existing) return existing.id;
  const [created] = await db.insert(plans).values({ courseId, name }).returning();
  console.log(`  [catalog] plan created: ${name} (course ${courseId})`);
  return created!.id;
}

async function upsertPlanPrice(db: Db, planId: string, amountCents: number, earliestSeenOn: Date): Promise<string> {
  const [existing] = await db
    .select()
    .from(planPrices)
    .where(and(eq(planPrices.planId, planId), eq(planPrices.amountCents, amountCents)));
  if (existing) return existing.id;
  const [created] = await db
    .insert(planPrices)
    .values({ planId, amountCents, validFrom: earliestSeenOn })
    .returning();
  console.log(`  [catalog] plan price created: S/${(amountCents / 100).toFixed(2)} (plan ${planId})`);
  return created!.id;
}

async function upsertAcademicPeriod(db: Db, year: number, month: number): Promise<string> {
  const name = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("es-PE", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const [existing] = await db.select().from(academicPeriods).where(eq(academicPeriods.name, name));
  if (existing) return existing.id;
  const startsOn = new Date(Date.UTC(year, month - 1, 1));
  const endsOn = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  const [created] = await db.insert(academicPeriods).values({ name, startsOn, endsOn }).returning();
  console.log(`  [catalog] academic period created: ${name}`);
  return created!.id;
}

async function upsertClassGroup(
  db: Db,
  courseId: string,
  academicPeriodId: string,
  record: LegacyRecord,
  capacity: number,
): Promise<string> {
  const code = record.classroomLabel?.trim() || `${record.courseKey}-${record.startsOn.toISOString().slice(0, 10)}`;
  // Matches on `schedule` too, not just (courseId, code, startsOn) — `code`
  // falls back to a course+date-only string whenever classroomLabel is
  // missing (common), which several DIFFERENT schedules on the same course
  // and date would all share; without this the existence check collapses
  // them onto one row instead of the distinct groups classGroupKey() (and
  // classGroupIdByKey below) actually intends.
  const [existing] = await db
    .select()
    .from(classGroups)
    .where(
      and(
        eq(classGroups.courseId, courseId),
        eq(classGroups.code, code),
        eq(classGroups.startsOn, record.startsOn),
        eq(classGroups.schedule, record.scheduleText),
      ),
    );
  if (existing) return existing.id;

  // No end date is recorded anywhere in the legacy sheets — 30 days is a
  // documented approximation, not a real duration; it only matters for
  // choosing 'finished' vs 'closed' below, since every imported group is
  // decided to be non-enrolling regardless (see the import's run summary).
  const endsOn = new Date(record.startsOn.getTime() + 30 * 24 * 60 * 60 * 1000);
  const status = endsOn.getTime() < Date.now() ? "finished" : "closed";

  const [created] = await db
    .insert(classGroups)
    .values({
      courseId,
      academicPeriodId,
      schedule: record.scheduleText,
      code,
      startsOn: record.startsOn,
      endsOn,
      capacity,
      seatsTaken: capacity,
      status,
    })
    .returning();
  return created!.id;
}

/** Derives and idempotently upserts the full catalog (courses, plans, plan
 * prices, academic periods, class groups) the given records need, then
 * returns lookup maps from the same grouping keys to the DB ids so the
 * enrollment/payment pass can resolve every record's plan_price_id and
 * class_group_id without re-querying per row. */
export async function ensureCatalog(db: Db, records: LegacyRecord[]): Promise<CatalogLookups> {
  const courseIdByKey = new Map<string, string>();
  const planIdByKey = new Map<string, string>();
  const classGroupIdByKey = new Map<string, string>();
  const periodIdByMonth = new Map<string, string>();

  const byCourse = new Map<string, { courseName: string; language: string }>();
  for (const r of records) byCourse.set(r.courseKey, { courseName: r.courseName, language: r.language });
  for (const [courseKey, { courseName, language }] of byCourse) {
    courseIdByKey.set(courseKey, await upsertCourse(db, courseKey, courseName, language));
  }

  const planPriceSeen = new Map<string, { planId: string; amountCents: number; earliest: Date }>();
  for (const r of records) {
    const pKey = planKey(r.courseKey, r.modality);
    if (!planIdByKey.has(pKey)) {
      const courseId = courseIdByKey.get(r.courseKey)!;
      planIdByKey.set(pKey, await upsertPlan(db, courseId, r.modality));
    }
    const planId = planIdByKey.get(pKey)!;
    const priceKey = `${planId}|${r.amountCents}`;
    const seen = planPriceSeen.get(priceKey);
    if (!seen || r.startsOn < seen.earliest) {
      planPriceSeen.set(priceKey, { planId, amountCents: r.amountCents, earliest: seen ? seen.earliest : r.startsOn });
    }
  }
  for (const { planId, amountCents, earliest } of planPriceSeen.values()) {
    await upsertPlanPrice(db, planId, amountCents, earliest);
  }

  const capacityByGroupKey = new Map<string, number>();
  for (const r of records) {
    const key = classGroupKey(r);
    if (r.paymentStatus === "approved") capacityByGroupKey.set(key, (capacityByGroupKey.get(key) ?? 0) + 1);
    else if (!capacityByGroupKey.has(key)) capacityByGroupKey.set(key, 0);
  }

  for (const r of records) {
    const gKey = classGroupKey(r);
    if (classGroupIdByKey.has(gKey)) continue;
    const monthKey = `${r.startsOn.getUTCFullYear()}-${r.startsOn.getUTCMonth() + 1}`;
    if (!periodIdByMonth.has(monthKey)) {
      periodIdByMonth.set(monthKey, await upsertAcademicPeriod(db, r.startsOn.getUTCFullYear(), r.startsOn.getUTCMonth() + 1));
    }
    const courseId = courseIdByKey.get(r.courseKey)!;
    const periodId = periodIdByMonth.get(monthKey)!;
    const capacity = Math.max(1, capacityByGroupKey.get(gKey) ?? 1);
    classGroupIdByKey.set(gKey, await upsertClassGroup(db, courseId, periodId, r, capacity));
  }

  return { classGroupIdByKey, planIdByKey };
}

export async function resolvePlanPriceId(db: Db, planId: string, amountCents: number): Promise<string> {
  const [row] = await db
    .select()
    .from(planPrices)
    .where(and(eq(planPrices.planId, planId), eq(planPrices.amountCents, amountCents)));
  if (!row) throw new Error(`plan price not found for plan=${planId} amount=${amountCents}`);
  return row.id;
}
