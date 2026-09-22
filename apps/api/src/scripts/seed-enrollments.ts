// Fills the enrollment ledger with invented seats, so /backoffice/enrollments
// can be worked against a list longer than one page.
//
// Usage:
//   pnpm --filter @ooc/api seed:enrollments
//   pnpm --filter @ooc/api seed:enrollments -- --count=600
//   pnpm --filter @ooc/api seed:enrollments -- --confirm-host=ep-xxx...neon.tech
//
// Needs students and a catalog already on file: it enrolls people who exist
// (`pnpm seed:students`) into courses and plans that exist (`pnpm
// seed:catalog`). It opens its own class groups, sized to hold what it is
// about to write — capacity is a real column with a real CHECK, and widening
// the groups coordination created would be editing their work, not seeding.
//
// Same guards as the student seed: local host writes freely, any other host
// needs `--confirm-host=<hostname>`, a production build is refused outright.
//
// ONE WAY, unlike the student seed, and worth knowing before running it: there
// is no `--undo`. `enrollments` gained a `deleted_at` in migration 0012, but
// the payments hanging off it have none and cannot be deleted either
// (CLAUDE.md §6 — no DELETE grant on payment), so retiring the enrollment
// would leave its money behind. Everything it writes is marked (the class groups
// carry a `SEED-` code), so what it created stays identifiable, but the way
// back to a clean ledger is a fresh database — on Neon, a new branch.
//
// Rerunning is safe: each payment carries a deterministic idempotency key, and
// the column is UNIQUE (CLAUDE.md §5), so a second run recognises what it
// already wrote instead of doubling it.
import { classGroups, courses, enrollments, payments, planPrices, plans, students } from "@ooc/db";
import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { container } from "@/container.js";
import {
  BATCH_SIZE,
  DEFAULT_COUNT,
  GROUP_CAPACITY,
  SEED_CODE_PREFIX,
  buildPlan,
  groupsNeeded,
} from "./seed-enrollments/plan.js";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];

const SCHEDULES = [
  "Lun/Mié 18:00-19:00",
  "Mar/Jue 18:00-19:00",
  "Lun-Vie 07:00-08:00",
  "Sáb 09:00-12:00",
  "Mar/Jue 20:00-21:00",
];

/** Same shape as the seed catalog's, so the screen renders a real schedule. */
const SLOTS: Record<string, Array<{ weekday: string; startTime: string; endTime: string }>> = {
  "Lun/Mié 18:00-19:00": [
    { weekday: "mon", startTime: "18:00", endTime: "19:00" },
    { weekday: "wed", startTime: "18:00", endTime: "19:00" },
  ],
  "Mar/Jue 18:00-19:00": [
    { weekday: "tue", startTime: "18:00", endTime: "19:00" },
    { weekday: "thu", startTime: "18:00", endTime: "19:00" },
  ],
  "Lun-Vie 07:00-08:00": [
    { weekday: "mon", startTime: "07:00", endTime: "08:00" },
    { weekday: "tue", startTime: "07:00", endTime: "08:00" },
    { weekday: "wed", startTime: "07:00", endTime: "08:00" },
    { weekday: "thu", startTime: "07:00", endTime: "08:00" },
    { weekday: "fri", startTime: "07:00", endTime: "08:00" },
  ],
  "Sáb 09:00-12:00": [{ weekday: "sat", startTime: "09:00", endTime: "12:00" }],
  "Mar/Jue 20:00-21:00": [
    { weekday: "tue", startTime: "20:00", endTime: "21:00" },
    { weekday: "thu", startTime: "20:00", endTime: "21:00" },
  ],
};

function resolveTarget(): { host: string; database: string } {
  if (container.production) {
    console.error("Refusing to seed invented enrollments into a production build. There is no flag for this.");
    process.exit(1);
  }

  const raw = process.env.DATABASE_URL ?? "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    console.error("DATABASE_URL is not a URL this script can read. Refusing to write.");
    process.exit(1);
  }

  const host = url.hostname;
  const database = url.pathname.replace(/^\//, "") || "(default)";

  if (LOCAL_HOSTS.includes(host)) return { host, database };

  const confirmed = process.argv
    .slice(2)
    .find((value) => value.startsWith("--confirm-host="))
    ?.slice("--confirm-host=".length);

  if (confirmed !== host) {
    console.error(
      `DATABASE_URL points at "${host}" (database "${database}"), which is not this machine.\n` +
        "Name the target to write to it — and note this seed cannot be taken back:\n\n" +
        `  pnpm --filter @ooc/api seed:enrollments -- --confirm-host=${host}\n\n` +
        (confirmed ? `Got --confirm-host=${confirmed}, which does not match.` : "No --confirm-host given."),
    );
    process.exit(1);
  }

  return { host, database };
}

function parseCount(): number {
  const arg = process.argv.slice(2).find((value) => value.startsWith("--count="));
  if (!arg) return DEFAULT_COUNT;

  const parsed = Number.parseInt(arg.slice("--count=".length), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5000) {
    console.error("--count must be an integer between 1 and 5000.");
    process.exit(1);
  }

  return parsed;
}

/** The plan in force for a course, with its current price — the same pair the
 * public checkout resolves server-side. The seed never invents an amount:
 * there are no discounts, ever (CLAUDE.md §1). */
async function loadPlans(): Promise<Array<{ courseId: string; planPriceId: string; amountCents: number }>> {
  const rows = await container.db
    .select({
      courseId: courses.id,
      planId: plans.id,
      planPriceId: planPrices.id,
      amountCents: planPrices.amountCents,
      validFrom: planPrices.validFrom,
    })
    .from(plans)
    .innerJoin(courses, eq(courses.id, plans.courseId))
    .innerJoin(planPrices, and(eq(planPrices.planId, plans.id), lte(planPrices.validFrom, sql`now()`)))
    .orderBy(plans.id, desc(planPrices.validFrom));

  // One price per plan: the freshest, which the ordering above put first.
  const seen = new Set<string>();
  const result: Array<{ courseId: string; planPriceId: string; amountCents: number }> = [];
  for (const row of rows) {
    if (seen.has(row.planId)) continue;
    seen.add(row.planId);
    result.push({ courseId: row.courseId, planPriceId: row.planPriceId, amountCents: row.amountCents });
  }
  return result;
}

async function main(): Promise<void> {
  const target = resolveTarget();
  const count = parseCount();
  const now = new Date();

  console.log(`Target: ${target.host} / ${target.database}`);

  const roster = await container.db
    .select({ id: students.id })
    .from(students)
    .where(isNull(students.deletedAt))
    .orderBy(students.createdAt)
    .limit(2000);

  if (roster.length === 0) {
    console.error("No students on file. Run `pnpm --filter @ooc/api seed:students` first — a seat belongs to somebody.");
    process.exit(1);
  }

  const available = await loadPlans();
  if (available.length === 0) {
    console.error("No course has a plan with a price in force. Run `pnpm --filter @ooc/api seed:catalog` first.");
    process.exit(1);
  }

  const [period] = await container.db
    .select({ id: sql<string>`id`, name: sql<string>`name` })
    .from(sql`academic_periods`)
    .orderBy(sql`starts_on desc`)
    .limit(1);

  if (!period) {
    console.error("No academic period on file. Run `pnpm --filter @ooc/api seed:catalog` first.");
    process.exit(1);
  }

  const planned = buildPlan(count, roster.length, now);

  // Already written? The idempotency key is the handle — it is UNIQUE, so a
  // rerun would fail on it rather than duplicate, and skipping is the quiet
  // version of the same answer.
  const keys = planned.map((item) => item.idempotencyKey);
  const already = new Set<string>();
  for (let start = 0; start < keys.length; start += BATCH_SIZE) {
    const rows = await container.db
      .select({ key: payments.idempotencyKey })
      .from(payments)
      .where(inArray(payments.idempotencyKey, keys.slice(start, start + BATCH_SIZE)));
    for (const row of rows) already.add(row.key);
  }

  const pending = planned.filter((item) => !already.has(item.idempotencyKey));
  if (pending.length === 0) {
    console.log(`All ${count} seeded enrollments are already on file. Nothing to do.`);
    process.exit(0);
  }

  // The class groups this run needs, opened under courses that already exist
  // and sized to hold the seats about to be written.
  const groupCount = groupsNeeded(count);
  const groupIds: string[] = [];
  const groupPrice: Array<{ planPriceId: string; amountCents: number }> = [];

  for (let index = 0; index < groupCount; index += 1) {
    const plan = available[index % available.length]!;
    const schedule = SCHEDULES[index % SCHEDULES.length]!;
    const startsOn = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const endsOn = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const code = `${SEED_CODE_PREFIX}-${String(index + 1).padStart(2, "0")}`;

    const [existing] = await container.db
      .select({ id: classGroups.id })
      .from(classGroups)
      .where(eq(classGroups.code, code))
      .limit(1);

    if (existing) {
      groupIds.push(existing.id);
      groupPrice.push({ planPriceId: plan.planPriceId, amountCents: plan.amountCents });
      continue;
    }

    const [created] = await container.db
      .insert(classGroups)
      .values({
        courseId: plan.courseId,
        academicPeriodId: period.id,
        schedule,
        slots: SLOTS[schedule] ?? [],
        code,
        teacherName: "Docente por asignar (seed)",
        startsOn,
        endsOn,
        capacity: GROUP_CAPACITY,
        status: "enrolling",
      })
      .returning({ id: classGroups.id });

    if (!created) throw new Error("Insert into class_groups returned no row");
    groupIds.push(created.id);
    groupPrice.push({ planPriceId: plan.planPriceId, amountCents: plan.amountCents });
  }

  let writtenEnrollments = 0;
  let writtenPayments = 0;
  const seatsPerGroup = new Map<string, number>();

  for (let start = 0; start < pending.length; start += BATCH_SIZE) {
    const slice = pending.slice(start, start + BATCH_SIZE);

    await container.db.transaction(async (tx) => {
      const enrollmentRows = await tx
        .insert(enrollments)
        .values(
          slice.map((item) => ({
            studentId: roster[item.studentSlot]!.id,
            classGroupId: groupIds[item.groupSlot]!,
            planPriceId: groupPrice[item.groupSlot]!.planPriceId,
            seatStatus: item.seatStatus,
            origin: item.origin,
            createdAt: item.createdAt,
            updatedAt: item.createdAt,
          })),
        )
        .returning({ id: enrollments.id });

      writtenEnrollments += enrollmentRows.length;

      const paymentRows = await tx
        .insert(payments)
        .values(
          slice.map((item, offset) => ({
            enrollmentId: enrollmentRows[offset]!.id,
            idempotencyKey: item.idempotencyKey,
            status: item.paymentStatus,
            method: item.method,
            methodDetail: item.methodDetail,
            // The plan price in force, never a number this script chose:
            // there are no discounts (CLAUDE.md §1).
            amountCents: groupPrice[item.groupSlot]!.amountCents,
            operationNumber: item.operationNumber,
            createdAt: item.createdAt,
            updatedAt: item.createdAt,
          })),
        )
        .returning({ id: payments.id });

      writtenPayments += paymentRows.length;

      for (const item of slice) {
        if (!item.holdsSeat) continue;
        const groupId = groupIds[item.groupSlot]!;
        seatsPerGroup.set(groupId, (seatsPerGroup.get(groupId) ?? 0) + 1);
      }
    });
  }

  /* `seats_taken` follows the seats that are actually held — a released one
     gave its place back. Written as one statement per group rather than a
     read-then-write, for the same reason the real checkout does it that way
     (CLAUDE.md §5): the column has a CHECK against capacity, and the database
     is what enforces it. */
  for (const [groupId, seats] of seatsPerGroup) {
    await container.db
      .update(classGroups)
      .set({ seatsTaken: sql`${classGroups.seatsTaken} + ${seats}`, updatedAt: new Date() })
      .where(eq(classGroups.id, groupId));
  }

  const held = pending.filter((item) => item.holdsSeat).length;

  console.log(
    `Seeded ${writtenEnrollments} enrollment(s) and ${writtenPayments} payment(s) across ${groupIds.length} class group(s) (${SEED_CODE_PREFIX}-nn).`,
  );
  console.log(`${held} of them hold a seat; the rest were released and gave it back.`);
  if (already.size > 0) {
    console.log(`${already.size} were already on file and were left alone.`);
  }
  console.log("No undo: payments have no deleted_at and cannot be deleted (CLAUDE.md §6).");

  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
