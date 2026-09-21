import { describe, expect, it } from "vitest";
import {
  DEFAULT_COUNT,
  GROUP_CAPACITY,
  buildPlan,
  groupsNeeded,
} from "@/scripts/seed-enrollments/plan.js";

/**
 * The ledger is where coordination reads what the institution sold, so seeded
 * rows have to be states the platform can actually produce. Two of these guard
 * something the database itself would catch only after the fact:
 *
 * - seat and payment must agree (`deriveStatus` reads both), or the screen
 *   shows a row nobody can explain;
 * - a released seat must not be counted as held, or `seats_taken` climbs past
 *   what is really occupied and the CHECK against capacity fires.
 */

const NOW = new Date("2026-09-22T12:00:00.000Z");
const STUDENTS = 304;

describe("seed-enrollments plan", () => {
  it("plans the asked-for number of seats", () => {
    expect(buildPlan(DEFAULT_COUNT, STUDENTS, NOW)).toHaveLength(300);
  });

  it("produces the same plan on a rerun", () => {
    expect(buildPlan(50, STUDENTS, NOW)).toEqual(buildPlan(50, STUDENTS, NOW));
  });

  it("gives every row its own idempotency key and operation number", () => {
    const plan = buildPlan(DEFAULT_COUNT, STUDENTS, NOW);

    // The column is UNIQUE (CLAUDE.md §5): a repeat would not duplicate, it
    // would fail the whole insert.
    expect(new Set(plan.map((row) => row.idempotencyKey)).size).toBe(plan.length);
    expect(new Set(plan.map((row) => row.operationNumber)).size).toBe(plan.length);
  });

  it("never pairs a confirmed seat with a refused payment", () => {
    const plan = buildPlan(DEFAULT_COUNT, STUDENTS, NOW);

    for (const row of plan) {
      if (row.seatStatus === "confirmed") expect(row.paymentStatus).toBe("approved");
      if (row.paymentStatus === "rejected") expect(row.seatStatus).toBe("released");
    }
  });

  it("counts a released seat as given back", () => {
    const plan = buildPlan(DEFAULT_COUNT, STUDENTS, NOW);

    for (const row of plan) {
      expect(row.holdsSeat).toBe(row.seatStatus !== "released");
    }
  });

  it("never puts more held seats in a group than its capacity", () => {
    const plan = buildPlan(DEFAULT_COUNT, STUDENTS, NOW);
    const held = new Map<number, number>();

    for (const row of plan) {
      if (!row.holdsSeat) continue;
      held.set(row.groupSlot, (held.get(row.groupSlot) ?? 0) + 1);
    }

    for (const seats of held.values()) {
      expect(seats).toBeLessThanOrEqual(GROUP_CAPACITY);
    }
  });

  it("opens enough class groups for the seats it plans", () => {
    expect(groupsNeeded(300)).toBe(5);
    expect(groupsNeeded(600)).toBe(10);

    const plan = buildPlan(600, STUDENTS, NOW);
    const slots = new Set(plan.map((row) => row.groupSlot));
    expect(Math.max(...slots)).toBeLessThan(groupsNeeded(600));
  });

  it("always names the rail when the method is `other`", () => {
    // "other" on a ledger line is a question nobody can answer six months
    // later — the free text IS the label (CLAUDE.md §4).
    const plan = buildPlan(DEFAULT_COUNT, STUDENTS, NOW);

    for (const row of plan) {
      if (row.method === "other") expect(row.methodDetail).toBeTruthy();
      else expect(row.methodDetail).toBeNull();
    }
  });

  it("reuses the roster when there are fewer students than seats", () => {
    const plan = buildPlan(300, 10, NOW);
    expect(Math.max(...plan.map((row) => row.studentSlot))).toBeLessThan(10);
  });

  it("covers every state the ledger filters by", () => {
    const plan = buildPlan(DEFAULT_COUNT, STUDENTS, NOW);

    expect(new Set(plan.map((row) => row.seatStatus))).toEqual(
      new Set(["reserved", "confirmed", "released"]),
    );
    expect(new Set(plan.map((row) => row.paymentStatus))).toEqual(
      new Set(["pending", "under_review", "approved", "rejected"]),
    );
    expect(new Set(plan.map((row) => row.method)).size).toBe(5);
  });
});
