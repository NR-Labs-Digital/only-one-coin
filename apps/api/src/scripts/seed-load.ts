// Fills a test database with invented volume — students, three periods, class
// groups across every language on file, enrollments, payments and receipts
// with their OCR reading and verdict — so the backoffice and the load test
// (ROADMAP Sessão 57) run against numbers close to the real ones (OOC-48).
//
// Usage:
//   pnpm --filter @ooc/api seed:load                      (profile `dev`)
//   pnpm --filter @ooc/api seed:load -- --profile=normal  (5,000 enrollments, a normal month)
//   pnpm --filter @ooc/api seed:load -- --profile=peak    (20,000, a peak month)
//   pnpm --filter @ooc/api seed:load -- --confirm-host=ep-xxx...neon.tech
//   pnpm db:reset:load                                    (local: empty database, then catalog + this seed)
//
// Needs a catalog with prices in force (`pnpm --filter @ooc/api seed`): it
// sells the plans that exist, at the price in force — never an amount of its
// own (no discounts, CLAUDE.md §1).
//
// Same guards as the other seeds: a local host writes freely, any other host
// needs `--confirm-host=<hostname>`, a production build is refused outright.
// Nothing here is real data (CLAUDE.md §6): invented people, invented receipts.
//
// Rerunning is safe: people are found by document, periods by name, class
// groups by their `LOAD-<PROFILE>-` code and payments by their idempotency key,
// so a second run writes only what is missing. Each profile writes its own
// class groups and enrollments; running `dev` and then `peak` leaves both on
// file, over the same students.
//
// ONE WAY, like seed:enrollments: payments, receipts and students cannot be
// deleted (CLAUDE.md §6 — the database refuses it), so there is no `--undo`.
// The reset is a fresh database: `pnpm db:reset:load` locally, a new branch on
// Neon.
//
// The receipts point at objects that are not in the bucket: the review queue
// lists them with their reading and verdict, and opening the image fails. The
// ones seeded as not read yet are offered to the OCR worker like any other
// when it runs (it needs OPENROUTER_API_KEY), and it records a failed reading.
import {
  academicPeriods,
  classGroups,
  courses,
  enrollments,
  guardians,
  paymentReceipts,
  payments,
  planPrices,
  platformSettings,
  plans,
  receiptUploads,
  seatHolds,
  students,
} from "@ooc/db";
import { RECEIPT_EXTRACTION_TIER_PRIMARY, type ReceiptValidationSettings } from "@ooc/domain";
import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { container } from "@/container.js";
import { buildPeople } from "./seed-students/people.js";
import {
  BATCH_SIZE,
  GROUP_CAPACITY,
  LOAD_MODEL_NAME,
  LOAD_PERIOD_PREFIX,
  LOAD_PERIODS,
  LOAD_PROFILES,
  buildClassGroups,
  buildEnrollments,
  type LoadProfileName,
} from "./seed-load/plan.js";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];
const DAY = 24 * 60 * 60 * 1000;

/** Same shape as the seed catalog's, so the screen renders a real timetable. */
const SLOT_SETS: Array<Array<{ weekday: string; startTime: string; endTime: string }>> = [
  [
    { weekday: "mon", startTime: "18:00", endTime: "19:30" },
    { weekday: "wed", startTime: "18:00", endTime: "19:30" },
  ],
  [
    { weekday: "tue", startTime: "19:00", endTime: "20:30" },
    { weekday: "thu", startTime: "19:00", endTime: "20:30" },
  ],
  [{ weekday: "sat", startTime: "09:00", endTime: "12:00" }],
  [
    { weekday: "mon", startTime: "07:00", endTime: "08:00" },
    { weekday: "wed", startTime: "07:00", endTime: "08:00" },
    { weekday: "fri", startTime: "07:00", endTime: "08:00" },
  ],
];

function resolveTarget(): { host: string; database: string } {
  if (container.production) {
    console.error("Refusing to seed invented volume into a production build. There is no flag for this.");
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
        `  pnpm --filter @ooc/api seed:load -- --confirm-host=${host}\n\n` +
        (confirmed ? `Got --confirm-host=${confirmed}, which does not match.` : "No --confirm-host given."),
    );
    process.exit(1);
  }

  return { host, database };
}

function parseProfile(): LoadProfileName {
  const arg = process.argv.slice(2).find((value) => value.startsWith("--profile="));
  if (!arg) return "dev";
  const name = arg.slice("--profile=".length);
  if (!(name in LOAD_PROFILES)) {
    console.error(`--profile must be one of: ${Object.keys(LOAD_PROFILES).join(", ")}.`);
    process.exit(1);
  }
  return name as LoadProfileName;
}

/** The plan in force for each live course, with its current price — what the checkout resolves. */
async function loadPlans(): Promise<Array<{ courseId: string; planPriceId: string; amountCents: number }>> {
  const rows = await container.db
    .select({
      courseId: courses.id,
      planId: plans.id,
      planPriceId: planPrices.id,
      amountCents: planPrices.amountCents,
    })
    .from(plans)
    .innerJoin(courses, eq(courses.id, plans.courseId))
    .innerJoin(planPrices, and(eq(planPrices.planId, plans.id), lte(planPrices.validFrom, sql`now()`)))
    .where(and(isNull(plans.deletedAt), isNull(courses.deletedAt)))
    .orderBy(courses.language, plans.id, desc(planPrices.validFrom));

  const seen = new Set<string>();
  const result: Array<{ courseId: string; planPriceId: string; amountCents: number }> = [];
  for (const row of rows) {
    if (seen.has(row.planId)) continue;
    seen.add(row.planId);
    result.push({ courseId: row.courseId, planPriceId: row.planPriceId, amountCents: row.amountCents });
  }
  return result;
}

/** The traffic light's numbers as the backoffice has them today — the verdicts are computed with them. */
async function loadSettings(): Promise<ReceiptValidationSettings> {
  const [row] = await container.db
    .select({
      toleranceCents: platformSettings.receiptAmountToleranceCents,
      rejectBelowPercent: platformSettings.receiptRejectBelowPercent,
    })
    .from(platformSettings)
    .limit(1);
  return row ?? { toleranceCents: 0, rejectBelowPercent: 50 };
}

/** The seeded people, inserted where missing; answers their ids in the generator's order. */
async function seedStudents(count: number, now: Date): Promise<{ ids: string[]; inserted: number }> {
  const people = buildPeople(count, now);
  const documents = people.map((person) => person.nationalId);

  const onFile = async (): Promise<Map<string, string>> => {
    const found = new Map<string, string>();
    for (let start = 0; start < documents.length; start += BATCH_SIZE) {
      const rows = await container.db
        .select({ id: students.id, nationalId: students.nationalId })
        .from(students)
        .where(and(inArray(students.nationalId, documents.slice(start, start + BATCH_SIZE)), isNull(students.deletedAt)));
      for (const row of rows) found.set(row.nationalId, row.id);
    }
    return found;
  };

  const existing = await onFile();
  const pending = people.filter((person) => !existing.has(person.nationalId));

  for (let start = 0; start < pending.length; start += BATCH_SIZE) {
    const slice = pending.slice(start, start + BATCH_SIZE);
    await container.db.transaction(async (tx) => {
      const rows = await tx
        .insert(students)
        .values(
          slice.map((person) => ({
            firstName: person.firstName,
            lastName: person.lastName,
            nationalIdType: "DNI",
            nationalId: person.nationalId,
            email: person.email,
            phone: person.phone,
            birthDate: person.birthDate,
            country: "PE",
            region: person.region,
            city: person.city,
            createdAt: person.createdAt,
            updatedAt: person.createdAt,
          })),
        )
        .returning({ id: students.id, nationalId: students.nationalId });

      const byDocument = new Map(rows.map((row) => [row.nationalId, row.id]));
      // A minor always has an apoderado; consent stays pending, as on a panel
      // registration — it is the guardian's own act (Ley 29733, CLAUDE.md §8).
      const guardianRows = slice
        .filter((person) => person.guardian !== null)
        .map((person) => ({
          studentId: byDocument.get(person.nationalId)!,
          firstName: person.guardian!.firstName,
          lastName: person.guardian!.lastName,
          relationship: person.guardian!.relationship,
          nationalIdType: "DNI",
          nationalId: person.guardian!.nationalId,
          email: person.guardian!.email,
          phone: person.guardian!.phone,
        }));
      if (guardianRows.length > 0) await tx.insert(guardians).values(guardianRows);
    });
  }

  const all = pending.length > 0 ? await onFile() : existing;
  return { ids: documents.map((document) => all.get(document)!), inserted: pending.length };
}

async function seedPeriods(now: Date): Promise<Map<number, string>> {
  const ids = new Map<number, string>();
  for (const period of LOAD_PERIODS) {
    const name = `${LOAD_PERIOD_PREFIX} ${period.index}`;
    const [existing] = await container.db
      .select({ id: academicPeriods.id })
      .from(academicPeriods)
      .where(and(eq(academicPeriods.name, name), isNull(academicPeriods.deletedAt)))
      .limit(1);
    if (existing) {
      ids.set(period.index, existing.id);
      continue;
    }
    // The sales campaign opens a month before its classes start.
    const [created] = await container.db
      .insert(academicPeriods)
      .values({
        name,
        startsOn: new Date(now.getTime() - (period.startsDaysAgo + 30) * DAY),
        endsOn: new Date(now.getTime() - period.endsDaysAgo * DAY),
      })
      .returning({ id: academicPeriods.id });
    ids.set(period.index, created!.id);
  }
  return ids;
}

async function main(): Promise<void> {
  const target = resolveTarget();
  const profileName = parseProfile();
  const profile = LOAD_PROFILES[profileName];
  const now = new Date();

  console.log(`Target: ${target.host} / ${target.database} — profile "${profileName}"`);

  const available = await loadPlans();
  if (available.length === 0) {
    console.error("No course has a plan with a price in force. Run `pnpm --filter @ooc/api seed` first.");
    process.exit(1);
  }

  const settings = await loadSettings();
  const roster = await seedStudents(profile.students, now);
  const periodIds = await seedPeriods(now);

  const plannedGroups = buildClassGroups(profile, available.length);
  const groupIds: string[] = [];
  for (const [index, group] of plannedGroups.entries()) {
    const [existing] = await container.db
      .select({ id: classGroups.id })
      .from(classGroups)
      .where(eq(classGroups.code, group.code))
      .limit(1);
    if (existing) {
      groupIds.push(existing.id);
      continue;
    }
    const plan = available[group.planSlot]!;
    const [created] = await container.db
      .insert(classGroups)
      .values({
        courseId: plan.courseId,
        academicPeriodId: periodIds.get(group.period.index)!,
        schedule: "",
        slots: SLOT_SETS[index % SLOT_SETS.length]!,
        code: group.code,
        startsOn: new Date(now.getTime() - group.period.startsDaysAgo * DAY),
        endsOn: new Date(now.getTime() - group.period.endsDaysAgo * DAY),
        capacity: GROUP_CAPACITY,
        status: group.period.status,
      })
      .returning({ id: classGroups.id });
    groupIds.push(created!.id);
  }

  const planned = buildEnrollments({
    profile,
    groups: plannedGroups,
    planAmounts: available.map((plan) => plan.amountCents),
    settings,
    now,
  });

  const already = new Set<string>();
  const keys = planned.map((item) => item.idempotencyKey);
  for (let start = 0; start < keys.length; start += BATCH_SIZE) {
    const rows = await container.db
      .select({ key: payments.idempotencyKey })
      .from(payments)
      .where(inArray(payments.idempotencyKey, keys.slice(start, start + BATCH_SIZE)));
    for (const row of rows) already.add(row.key);
  }
  const pending = planned.filter((item) => !already.has(item.idempotencyKey));

  let receipts = 0;

  for (let start = 0; start < pending.length; start += BATCH_SIZE) {
    const slice = pending.slice(start, start + BATCH_SIZE);

    // One transaction per batch: a batch is either all on file or not at all,
    // so a rerun after a crash picks up from the first missing key.
    await container.db.transaction(async (tx) => {
      const enrollmentRows = await tx
        .insert(enrollments)
        .values(
          slice.map((item) => ({
            studentId: roster.ids[item.studentSlot]!,
            classGroupId: groupIds[item.groupSlot]!,
            planPriceId: available[plannedGroups[item.groupSlot]!.planSlot]!.planPriceId,
            seatStatus: item.seatStatus,
            origin: item.origin,
            createdAt: item.createdAt,
            updatedAt: item.createdAt,
          })),
        )
        .returning({ id: enrollments.id });

      const decided = (status: string) => status === "approved" || status === "rejected";
      const paymentRows = await tx
        .insert(payments)
        .values(
          slice.map((item, offset) => ({
            enrollmentId: enrollmentRows[offset]!.id,
            idempotencyKey: item.idempotencyKey,
            status: item.paymentStatus,
            method: item.method,
            methodDetail: item.methodDetail,
            amountCents: available[plannedGroups[item.groupSlot]!.planSlot]!.amountCents,
            operationNumber: item.operationNumber,
            // Decided a day after it arrived; the seed has no reviewer, so nobody is named.
            decidedAt: decided(item.paymentStatus) ? new Date(item.createdAt.getTime() + DAY) : null,
            rejectionReason: item.rejectionReason,
            createdAt: item.createdAt,
            updatedAt: item.createdAt,
          })),
        )
        .returning({ id: payments.id });

      const withReceipt = slice
        .map((item, offset) => ({ item, enrollmentId: enrollmentRows[offset]!.id, paymentId: paymentRows[offset]!.id }))
        .filter((row) => row.item.receipt !== null);

      if (withReceipt.length > 0) {
        // The checkout hold the receipt was uploaded under, consumed by the submit.
        const holdRows = await tx
          .insert(seatHolds)
          .values(
            withReceipt.map(({ item, enrollmentId }) => ({
              classGroupId: groupIds[item.groupSlot]!,
              origin: item.origin,
              status: "consumed",
              expiresAt: new Date(item.createdAt.getTime() + 15 * 60 * 1000),
              settledAt: item.createdAt,
              enrollmentId,
              createdAt: item.createdAt,
              updatedAt: item.createdAt,
            })),
          )
          .returning({ id: seatHolds.id });

        const uploadRows = await tx
          .insert(receiptUploads)
          .values(
            withReceipt.map(({ item, paymentId }, offset) => {
              const receipt = item.receipt!;
              const read = receipt.reading;
              const at = new Date(item.createdAt.getTime() + 60 * 1000);
              return {
                seatHoldId: holdRows[offset]!.id,
                paymentId,
                objectKey: receipt.objectKey,
                status: "processed",
                contentType: "image/jpeg",
                byteSize: 80_000 + (offset % 40) * 1_000,
                processedObjectKey: receipt.processedObjectKey,
                fraudSignals: [],
                screenedAt: at,
                validationVerdict: read?.outcome.verdict ?? null,
                validationDetail: read
                  ? {
                      reason: read.outcome.reason,
                      expectedCents: available[plannedGroups[item.groupSlot]!.planSlot]!.amountCents,
                      readCents: read.amountCents,
                      ...settings,
                    }
                  : null,
                validatedAt: read ? at : null,
                createdAt: item.createdAt,
                updatedAt: at,
              };
            }),
          )
          .returning({ id: receiptUploads.id });

        const readings = withReceipt
          .map(({ item, paymentId }, offset) => ({ item, paymentId, uploadId: uploadRows[offset]!.id }))
          .filter(({ item }) => item.receipt!.reading !== null);

        if (readings.length > 0) {
          await tx.insert(paymentReceipts).values(
            readings.map(({ item, paymentId, uploadId }) => ({
              paymentId,
              receiptUploadId: uploadId,
              operationNumber: item.receipt!.reading!.operationNumber,
              amountCents: item.receipt!.reading!.amountCents,
              tier: RECEIPT_EXTRACTION_TIER_PRIMARY,
              modelName: LOAD_MODEL_NAME,
              modelVersion: LOAD_MODEL_NAME,
              extractedFields: item.receipt!.reading!.fields,
              createdAt: new Date(item.createdAt.getTime() + 60 * 1000),
            })),
          );
        }
        receipts += withReceipt.length;
      }

      /* The seats this batch holds, counted in the same transaction: a run cut
         short never leaves `seats_taken` disagreeing with the enrollments on
         file. One statement per group, against the CHECK on capacity — never
         read, add, write. */
      const seats = new Map<string, number>();
      for (const item of slice) {
        if (!item.holdsSeat) continue;
        const groupId = groupIds[item.groupSlot]!;
        seats.set(groupId, (seats.get(groupId) ?? 0) + 1);
      }
      for (const [groupId, count] of seats) {
        await tx
          .update(classGroups)
          .set({ seatsTaken: sql`${classGroups.seatsTaken} + ${count}`, updatedAt: new Date() })
          .where(eq(classGroups.id, groupId));
      }
    });

    process.stdout.write(`\r${Math.min(start + BATCH_SIZE, pending.length)} / ${pending.length} enrollments`);
  }
  if (pending.length > 0) process.stdout.write("\n");

  console.log(`Students: ${roster.ids.length} seeded (${roster.inserted} new).`);
  console.log(`Class groups: ${groupIds.length} across 3 periods and ${available.length} plan(s).`);
  console.log(
    `Enrollments: ${pending.length} new, each with its payment; ${receipts} with a receipt.` +
      (already.size > 0 ? ` ${already.size} were already on file and were left alone.` : ""),
  );
  console.log("No undo: payments and receipts cannot be deleted (CLAUDE.md §6). Reset with `pnpm db:reset:load`.");

  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
