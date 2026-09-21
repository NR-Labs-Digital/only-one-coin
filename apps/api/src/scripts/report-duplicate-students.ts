// Step one of putting a unique index on (national_id_type, national_id):
// finding out what is already in there. A unique index created over a table
// that still holds duplicates simply fails, so the consolidation comes first
// and the constraint second (CLAUDE.md §7 — expand/contract, never one big
// destructive step).
//
// Read-only. It writes nothing, in any environment: it prints what it found
// and exits. Consolidating is a separate, deliberate act, and which row wins
// is a decision for whoever knows the students, not for a script.
//
// Usage:
//   pnpm --filter @ooc/api report:duplicate-students
//   pnpm --filter @ooc/api report:duplicate-students -- --csv > duplicates.csv
import { enrollments, students } from "@ooc/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { container } from "@/container.js";

interface DuplicateRow {
  nationalIdType: string;
  nationalId: string;
  studentId: string;
  fullName: string;
  email: string;
  createdAt: Date;
  enrollmentCount: number;
}

async function findDuplicates(): Promise<DuplicateRow[]> {
  const { db } = container;

  // The documents carried by more than one live record. Soft-deleted rows are
  // out of it: they are already retired, and the unique index will be created
  // over the live ones (a partial index on deleted_at IS NULL), so a retired
  // duplicate is not something anybody has to consolidate.
  const offendingDocuments = db
    .select({
      nationalIdType: students.nationalIdType,
      nationalId: students.nationalId,
    })
    .from(students)
    .where(isNull(students.deletedAt))
    .groupBy(students.nationalIdType, students.nationalId)
    .having(sql`count(*) > 1`)
    .as("offending");

  const rows = await db
    .select({
      nationalIdType: students.nationalIdType,
      nationalId: students.nationalId,
      studentId: students.id,
      firstName: students.firstName,
      lastName: students.lastName,
      email: students.email,
      createdAt: students.createdAt,
      // How much history each copy is holding — the number that decides which
      // row a human wants to keep.
      enrollmentCount: sql<number>`(
        select count(*) from ${enrollments} where ${enrollments.studentId} = ${students.id}
      )::int`,
    })
    .from(students)
    .innerJoin(
      offendingDocuments,
      and(
        eq(students.nationalIdType, offendingDocuments.nationalIdType),
        eq(students.nationalId, offendingDocuments.nationalId),
      ),
    )
    .where(isNull(students.deletedAt))
    .orderBy(students.nationalIdType, students.nationalId, students.createdAt);

  return rows.map((row) => ({
    nationalIdType: row.nationalIdType,
    nationalId: row.nationalId,
    studentId: row.studentId,
    fullName: `${row.firstName} ${row.lastName}`,
    email: row.email,
    createdAt: row.createdAt,
    enrollmentCount: row.enrollmentCount,
  }));
}

function printCsv(rows: DuplicateRow[]): void {
  console.log("national_id_type,national_id,student_id,full_name,email,created_at,enrollments");
  for (const row of rows) {
    const cells = [
      row.nationalIdType,
      row.nationalId,
      row.studentId,
      `"${row.fullName.replace(/"/g, '""')}"`,
      row.email,
      row.createdAt.toISOString(),
      String(row.enrollmentCount),
    ];
    console.log(cells.join(","));
  }
}

function printSummary(rows: DuplicateRow[]): void {
  if (rows.length === 0) {
    console.log("No duplicate documents among live students. The unique index can be created as is.");
    return;
  }

  const byDocument = new Map<string, DuplicateRow[]>();
  for (const row of rows) {
    const key = `${row.nationalIdType} ${row.nationalId}`;
    byDocument.set(key, [...(byDocument.get(key) ?? []), row]);
  }

  console.log(`${byDocument.size} document(s) carried by more than one live student row.`);
  console.log(`${rows.length} student row(s) involved.\n`);

  for (const [document, copies] of byDocument) {
    const withHistory = copies.filter((copy) => copy.enrollmentCount > 0).length;
    console.log(`${document} — ${copies.length} rows, ${withHistory} of them with enrollments:`);
    for (const copy of copies) {
      console.log(
        `  ${copy.studentId}  ${copy.createdAt.toISOString().slice(0, 10)}  ` +
          `${copy.enrollmentCount} enrollment(s)  ${copy.fullName} <${copy.email}>`,
      );
    }
    console.log("");
  }

  const splitHistory = [...byDocument.values()].filter(
    (copies) => copies.filter((copy) => copy.enrollmentCount > 0).length > 1,
  ).length;

  if (splitHistory > 0) {
    console.log(
      `${splitHistory} of these have enrollments on more than one row — those are the ones whose ` +
        "history is genuinely split, and they need a decision before anything is merged.",
    );
  }
}

async function main(): Promise<void> {
  const rows = await findDuplicates();

  if (process.argv.includes("--csv")) {
    printCsv(rows);
  } else {
    printSummary(rows);
  }

  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
