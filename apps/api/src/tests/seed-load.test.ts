import { describe, expect, it } from "vitest";
import {
  GROUP_CAPACITY,
  LOAD_PROFILES,
  buildClassGroups,
  buildEnrollments,
  classGroupsNeeded,
  type LoadProfile,
} from "@/scripts/seed-load/plan.js";

/**
 * The load seed (OOC-48) writes volume the backoffice and the load test read
 * as if it were real, so every row has to be a state the platform produces:
 *
 * - seat and payment agree, and a decided payment carries what decided it;
 * - the traffic light only validates: green stays `pending`, never
 *   `under_review`, and an open payment in review has a non-green verdict;
 * - no class group is planned past its capacity (the CHECK would fire);
 * - a rerun plans the same rows, which is what makes it idempotent.
 */

const NOW = new Date("2026-10-28T12:00:00.000Z");
const SETTINGS = { toleranceCents: 0, rejectBelowPercent: 50 };
const AMOUNTS = [9900, 15000, 25000];

function plan(profile: LoadProfile = LOAD_PROFILES.dev) {
  const groups = buildClassGroups(profile, AMOUNTS.length);
  return { groups, enrollments: buildEnrollments({ profile, groups, planAmounts: AMOUNTS, settings: SETTINGS, now: NOW }) };
}

describe("seed-load plan", () => {
  it("plans the profile's volume", () => {
    const { groups, enrollments } = plan();
    expect(enrollments).toHaveLength(LOAD_PROFILES.dev.enrollments);
    expect(groups).toHaveLength(40);
    expect(new Set(groups.map((group) => group.period.index))).toEqual(new Set([1, 2, 3]));
  });

  it("opens enough class groups for the peak month", () => {
    expect(classGroupsNeeded(LOAD_PROFILES.peak)).toBe(LOAD_PROFILES.peak.enrollments / GROUP_CAPACITY);
  });

  it("produces the same plan on a rerun", () => {
    expect(plan().enrollments).toEqual(plan().enrollments);
  });

  it("never plans a class group past its capacity", () => {
    for (const profile of Object.values(LOAD_PROFILES)) {
      const { enrollments } = plan(profile);
      const seats = new Map<number, number>();
      for (const item of enrollments) {
        if (item.holdsSeat) seats.set(item.groupSlot, (seats.get(item.groupSlot) ?? 0) + 1);
      }
      expect(Math.max(...seats.values())).toBeLessThanOrEqual(GROUP_CAPACITY);
    }
  });

  it("keeps unique idempotency keys, receipt keys and operation numbers", () => {
    const { enrollments } = plan(LOAD_PROFILES.normal);
    const unique = (values: unknown[]) => new Set(values).size === values.length;
    expect(unique(enrollments.map((item) => item.idempotencyKey))).toBe(true);
    expect(unique(enrollments.map((item) => item.operationNumber))).toBe(true);
    expect(unique(enrollments.flatMap((item) => (item.receipt ? [item.receipt.objectKey] : [])))).toBe(true);
  });

  it("pairs seat and payment the way the platform does", () => {
    for (const item of plan(LOAD_PROFILES.normal).enrollments) {
      if (item.paymentStatus === "approved") expect(item.seatStatus).toBe("confirmed");
      if (item.paymentStatus === "rejected") expect(item.seatStatus).toBe("released");
      if (item.seatStatus === "confirmed") expect(item.paymentStatus).toBe("approved");
      expect(item.rejectionReason !== null).toBe(item.paymentStatus === "rejected");
      expect(item.holdsSeat).toBe(item.seatStatus !== "released");
      expect(item.methodDetail !== null).toBe(item.method === "other");
    }
  });

  it("never lets the traffic light decide: green stays pending, review carries a non-green verdict", () => {
    for (const item of plan(LOAD_PROFILES.normal).enrollments) {
      const verdict = item.receipt?.reading?.outcome.verdict;
      if (item.paymentStatus === "under_review") expect(verdict).toMatch(/^(review|reject_suggested)$/);
      if (item.paymentStatus === "pending" && verdict !== undefined) expect(verdict).toBe("approve");
    }
  });

  it("reads green only what matches the price in force, the operation and the rail", () => {
    const { groups, enrollments } = plan();
    for (const item of enrollments) {
      const reading = item.receipt?.reading;
      if (reading?.outcome.verdict !== "approve") continue;
      expect(reading.amountCents).toBe(AMOUNTS[groups[item.groupSlot]!.planSlot]);
      expect(reading.operationNumber).toBe(item.operationNumber);
    }
  });

  it("leaves nothing open in the period that already ended", () => {
    const { groups, enrollments } = plan();
    for (const item of enrollments) {
      if (groups[item.groupSlot]!.period.status !== "finished") continue;
      expect(item.paymentStatus).toMatch(/^(approved|rejected)$/);
    }
  });

  it("keeps each profile to its own class groups, keys and operation numbers", () => {
    const dev = plan(LOAD_PROFILES.dev);
    const peak = plan(LOAD_PROFILES.peak);
    const shared = (a: string[], b: string[]) => a.some((value) => new Set(b).has(value));
    expect(shared(dev.groups.map((g) => g.code), peak.groups.map((g) => g.code))).toBe(false);
    expect(shared(dev.enrollments.map((e) => e.idempotencyKey), peak.enrollments.map((e) => e.idempotencyKey))).toBe(false);
    expect(shared(dev.enrollments.map((e) => e.operationNumber), peak.enrollments.map((e) => e.operationNumber))).toBe(false);
  });

  it("produces every verdict the review queue sorts by", () => {
    const verdicts = new Set(plan().enrollments.map((item) => item.receipt?.reading?.outcome.verdict ?? null));
    expect(verdicts).toEqual(new Set(["approve", "review", "reject_suggested", null]));
  });
});
