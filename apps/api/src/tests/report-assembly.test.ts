import { describe, expect, it } from "vitest";
import {
  assembleReport,
  fillMonths,
  type ClassGroupFactRow,
  type RunFactRow,
} from "@/infra/persistence/report/assembleReport.js";

/** The reports' cut (OOC-40), over facts written by hand — no database. */

const OLD = { id: "p-old", name: "2026-I", startsOn: new Date("2026-01-05T00:00:00Z") };
const NEW = { id: "p-new", name: "2026-II", startsOn: new Date("2026-07-05T00:00:00Z") };
const EMPTY_PERIOD = { id: "p-empty", name: "2027-I", startsOn: new Date("2027-01-05T00:00:00Z") };

function run(overrides: Partial<RunFactRow>): RunFactRow {
  return {
    periodId: NEW.id,
    courseId: "c-en",
    courseName: "Inglés Básico",
    languageKey: "l-en",
    languageName: "Inglés",
    teacherId: null,
    teacherName: null,
    enrollments: 0,
    reserved: 0,
    collectedCents: 0,
    pendingCents: 0,
    pendingCount: 0,
    lowGrades: 0,
    ...overrides,
  };
}

function group(overrides: Partial<ClassGroupFactRow>): ClassGroupFactRow {
  return {
    periodId: NEW.id,
    courseId: "c-en",
    courseName: "Inglés Básico",
    languageKey: "l-en",
    languageName: "Inglés",
    teachers: [],
    seatsTaken: 0,
    capacity: 0,
    ...overrides,
  };
}

const runs = [
  run({ enrollments: 10, collectedCents: 150000, teacherId: "t-ana", teacherName: "Ana Ríos", lowGrades: 2 }),
  run({ enrollments: 4, reserved: 2, pendingCents: 30000, pendingCount: 2 }),
  run({ courseId: "c-fr", courseName: "Francés", languageKey: "l-fr", languageName: "Francés", enrollments: 3, collectedCents: 45000 }),
  run({ periodId: OLD.id, enrollments: 7, collectedCents: 105000 }),
];

const classGroups = [
  // Two teachers run modules of the same class group.
  group({ seatsTaken: 18, capacity: 30, teachers: [{ id: "t-ana", name: "Ana Ríos" }, { id: "t-luis", name: "Luis Paz" }] }),
  group({ courseId: "c-fr", courseName: "Francés", languageKey: "l-fr", languageName: "Francés", seatsTaken: 3, capacity: 20 }),
  group({ periodId: OLD.id, seatsTaken: 7, capacity: 30 }),
];

function report(periodId: string | null, dimension: "course" | "language" | "teacher") {
  return assembleReport({ periods: [OLD, NEW, EMPTY_PERIOD], runs, classGroups, months: [], periodId, dimension });
}

describe("assembleReport", () => {
  it("lists only the periods the facts cover, newest first", () => {
    expect(report(null, "course").periods).toEqual([
      { id: NEW.id, name: NEW.name },
      { id: OLD.id, name: OLD.name },
    ]);
  });

  it("scopes rows and totals to the period", () => {
    const { rows, totals } = report(NEW.id, "course");
    expect(rows.find((row) => row.key === "course:c-en")).toMatchObject({
      sublabel: "Inglés",
      enrollments: 14,
      reserved: 2,
      collectedCents: 150000,
      pendingCents: 30000,
      seatsTaken: 18,
      capacity: 30,
      classGroups: 1,
    });
    expect(totals).toEqual({
      enrollments: 17,
      reserved: 2,
      collectedCents: 195000,
      pendingCents: 30000,
      pendingCount: 2,
      seatsTaken: 21,
      capacity: 50,
      classGroups: 2,
    });
  });

  it("counts a class group's seats under each of its teachers, and once in the totals", () => {
    const { rows, totals } = report(NEW.id, "teacher");
    expect(rows.find((row) => row.key === "teacher:t-ana")).toMatchObject({ enrollments: 10, capacity: 30 });
    expect(rows.find((row) => row.key === "teacher:t-luis")).toMatchObject({ enrollments: 0, capacity: 30 });
    expect(rows.find((row) => row.key === "teacher:none")).toMatchObject({
      label: { kind: "no_teacher" },
      enrollments: 7,
      capacity: 20,
    });
    expect(totals.capacity).toBe(50);
  });

  it("draws the trend over every period, whatever the filter", () => {
    const { trend } = report(NEW.id, "language");
    expect(trend.periods.map((period) => period.id)).toEqual([OLD.id, NEW.id]);
    expect(trend.series[0]).toEqual({ key: "language:l-en", label: { kind: "name", name: "Inglés" }, values: [7, 14] });
  });

  it("ranks by course, biggest first, leaving out what never happened", () => {
    const { rankings } = report(NEW.id, "teacher");
    expect(rankings.volume.map((course) => [course.name, course.count])).toEqual([
      ["Inglés Básico", 14],
      ["Francés", 3],
    ]);
    expect(rankings.lowGrades).toEqual([{ key: "c-en", name: "Inglés Básico", count: 2 }]);
  });
});

describe("fillMonths", () => {
  it("keeps the empty months between the first and the last, across a year", () => {
    expect(
      fillMonths([
        { month: "2026-11", enrollments: 3, collectedCents: 100 },
        { month: "2027-02", enrollments: 1, collectedCents: 50 },
      ]).map((month) => [month.month, month.enrollments]),
    ).toEqual([
      ["2026-11", 3],
      ["2026-12", 0],
      ["2027-01", 0],
      ["2027-02", 1],
    ]);
  });
});
