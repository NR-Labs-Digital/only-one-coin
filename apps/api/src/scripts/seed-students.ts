// Fills the student directory with invented people, so the backoffice's
// pagination, search and filters can be worked against a list that is longer
// than one page.
//
// Usage:
//   pnpm --filter @ooc/api seed:students
//   pnpm --filter @ooc/api seed:students -- --count=300
//   pnpm --filter @ooc/api seed:students -- --confirm-host=ep-xxx.sa-east-1.aws.neon.tech
//   pnpm --filter @ooc/api seed:students -- --undo   (same flags; retires them again)
//
// A managed database is a legitimate target — a seed of invented, anonymous
// people is exactly what CLAUDE.md §6 asks for ("seed anonimizado, nunca
// dump") and the owner develops against Neon rather than a local Postgres.
// What the script will not do is write somewhere nobody named:
//
//   - local host (localhost/127.0.0.1): writes, no ceremony.
//   - anywhere else: needs `--confirm-host=<hostname>` spelling out the host
//     it is about to write to, matching DATABASE_URL. Typing the host is the
//     whole safeguard — it makes "whatever .env happened to hold" impossible
//     to hit by accident, which is the realistic way invented people end up
//     in front of the school.
//   - a production build (NODE_ENV=production): refused outright, no flag.
//
// Rerunning is safe. The generator is deterministic (same seed, same 300
// people, same documents), and every document already on file is skipped —
// which matters twice over now that one document means one person
// (CLAUDE.md §1).
//
// `--undo` retires what this script created: `deleted_at`, never a DELETE
// (CLAUDE.md §6 — there is no DELETE grant on students). The directory, the
// ledger and the document lookup all ignore retired rows, so the panel goes
// back to what it was. It only ever touches the documents this generator
// produces, and it refuses to retire anybody carrying an enrollment — a
// seeded person somebody has since enrolled is real work, not a fixture.
import { enrollments, guardians, students } from "@ooc/db";
import { and, inArray, isNull, sql } from "drizzle-orm";
import { container } from "@/container.js";
import { BATCH_SIZE, DEFAULT_COUNT, buildPeople } from "./seed-students/people.js";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];

/**
 * Names the database about to be written to, and refuses the two cases that
 * are never a mistake worth making: a production build, and a remote host
 * nobody spelled out on the command line.
 */
function resolveTarget(): { host: string; database: string } {
  if (container.production) {
    console.error("Refusing to seed invented students into a production build. There is no flag for this.");
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

  if (LOCAL_HOSTS.includes(host)) {
    return { host, database };
  }

  const confirmed = process.argv
    .slice(2)
    .find((value) => value.startsWith("--confirm-host="))
    ?.slice("--confirm-host=".length);

  if (confirmed !== host) {
    console.error(
      `DATABASE_URL points at "${host}" (database "${database}"), which is not this machine.\n` +
        "Seeding a shared database is allowed — an anonymous seed is what CLAUDE.md §6 asks for — but the\n" +
        "target has to be named, so it can never be whatever .env happened to hold:\n\n" +
        `  pnpm --filter @ooc/api seed:students -- --confirm-host=${host}\n\n` +
        (confirmed
          ? `Got --confirm-host=${confirmed}, which does not match.`
          : "No --confirm-host given."),
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

/**
 * Retires the seeded people: `deleted_at`, never a DELETE (CLAUDE.md §6). The
 * directory, the enrollment ledger and the document lookup all filter retired
 * rows out, so the panel reads as it did before the seed.
 *
 * Anyone carrying an enrollment is left alone and reported. A seeded person
 * somebody has since put in a class group stopped being a fixture the moment
 * that happened, and retiring them would hide a seat that exists.
 */
async function undo(documents: string[]): Promise<void> {
  const inUse: string[] = [];
  let retired = 0;

  for (let start = 0; start < documents.length; start += BATCH_SIZE) {
    const slice = documents.slice(start, start + BATCH_SIZE);

    const rows = await container.db
      .select({
        id: students.id,
        nationalId: students.nationalId,
        enrollmentCount: sql<number>`(
          select count(*) from ${enrollments} where ${enrollments.studentId} = ${students.id}
        )::int`,
      })
      .from(students)
      .where(and(inArray(students.nationalId, slice), isNull(students.deletedAt)));

    const retirable = rows.filter((row) => row.enrollmentCount === 0).map((row) => row.id);
    for (const row of rows) {
      if (row.enrollmentCount > 0) inUse.push(row.nationalId);
    }

    if (retirable.length > 0) {
      const updated = await container.db
        .update(students)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(inArray(students.id, retirable))
        .returning({ id: students.id });
      retired += updated.length;
    }
  }

  console.log(`Retired ${retired} seeded student(s) — marked deleted_at, nothing removed from the table.`);
  if (inUse.length > 0) {
    console.log(
      `${inUse.length} were left alone because they carry an enrollment: ${inUse.slice(0, 10).join(", ")}` +
        (inUse.length > 10 ? ", …" : ""),
    );
  }
}

export async function main(): Promise<void> {
  const target = resolveTarget();
  const count = parseCount();
  const now = new Date();
  const people = buildPeople(count, now);
  const documents = people.map((person) => person.nationalId);

  console.log(`Target: ${target.host} / ${target.database}`);

  if (process.argv.includes("--undo")) {
    await undo(documents);
    process.exit(0);
  }

  // One document, one person (CLAUDE.md §1) — so a rerun adds what is missing
  // instead of a second copy of everybody. Checked here because the unique
  // index does not exist yet; when it does, this stays as the thing that makes
  // the rerun quiet instead of an error.
  const existing = new Set<string>();

  for (let start = 0; start < documents.length; start += BATCH_SIZE) {
    const slice = documents.slice(start, start + BATCH_SIZE);
    const rows = await container.db
      .select({ nationalId: students.nationalId })
      .from(students)
      // Retired rows do not count as on file — same rule the document lookup
      // follows (DrizzleStudentRepository.findByNationalId), and what makes
      // `--undo` followed by another seed put the directory back instead of
      // finding everybody "already there" and doing nothing.
      .where(and(inArray(students.nationalId, slice), isNull(students.deletedAt)));
    for (const row of rows) existing.add(row.nationalId);
  }

  const pending = people.filter((person) => !existing.has(person.nationalId));

  if (pending.length === 0) {
    console.log(`All ${count} seeded students are already on file. Nothing to do.`);
    process.exit(0);
  }

  let insertedStudents = 0;
  let insertedGuardians = 0;

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

      insertedStudents += rows.length;

      const byDocument = new Map(rows.map((row) => [row.nationalId, row.id]));
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

      if (guardianRows.length > 0) {
        // A minor without an apoderado is a row the domain refuses to create
        // (GuardianRequiredForMinorError) — seeded data must not be shaped
        // like something the platform would never accept.
        //
        // No consent row: consent is the guardian's own act, with their date,
        // version and IP (Ley 29733, CLAUDE.md §8). A seeded ficha is born
        // with it pending, exactly like one registered from the panel.
        const inserted = await tx.insert(guardians).values(guardianRows).returning({ id: guardians.id });
        insertedGuardians += inserted.length;
      }
    });
  }

  const minors = pending.filter((person) => person.guardian !== null).length;

  console.log(`Seeded ${insertedStudents} student(s) — ${minors} under age, with ${insertedGuardians} guardian(s).`);
  if (existing.size > 0) {
    console.log(`${existing.size} were already on file and were left alone.`);
  }
  console.log("Consent is pending on every seeded guardian, same as a panel registration.");

  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

