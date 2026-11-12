import { byClassGroupFillOrder, classGroupOfferKey } from "@ooc/domain";
import { describe, expect, it } from "vitest";

/**
 * The one definition of "same schedule" (OOC-140) and of the order its class
 * groups fill in (OOC-145). The checkout groups cards with it and the seat
 * claim fills with it; if this moves, both move together.
 */

const MON = { weekday: "mon", startTime: "19:00", endTime: "20:30" };
const WED = { weekday: "wed", startTime: "19:00", endTime: "20:30" };
const base = {
  courseId: "course",
  startsOn: "2026-03-02T05:00:00.000Z",
  endsOn: "2026-06-30T05:00:00.000Z",
  slots: [MON, WED],
};

describe("classGroupOfferKey", () => {
  it("is the same week whatever order the slots were saved in", () => {
    expect(classGroupOfferKey({ ...base, slots: [WED, MON] })).toBe(classGroupOfferKey(base));
  });

  it("tells apart another course, other dates and another hour", () => {
    const key = classGroupOfferKey(base);
    expect(classGroupOfferKey({ ...base, courseId: "other" })).not.toBe(key);
    expect(classGroupOfferKey({ ...base, startsOn: "2026-03-09T05:00:00.000Z" })).not.toBe(key);
    expect(classGroupOfferKey({ ...base, endsOn: "2026-07-31T05:00:00.000Z" })).not.toBe(key);
    expect(classGroupOfferKey({ ...base, slots: [MON, { ...WED, startTime: "20:00" }] })).not.toBe(key);
  });
});

describe("byClassGroupFillOrder", () => {
  it("fills by code as a number, so A-100000 comes after A-99999", () => {
    const groups = [
      { id: "c", code: "A-100000" },
      { id: "a", code: "A-00002" },
      { id: "b", code: "A-99999" },
    ];
    expect([...groups].sort(byClassGroupFillOrder).map((group) => group.code)).toEqual([
      "A-00002",
      "A-99999",
      "A-100000",
    ]);
  });

  it("breaks a tie between legacy rows sharing a code by id", () => {
    const groups = [
      { id: "b", code: "" },
      { id: "a", code: "" },
    ];
    expect([...groups].sort(byClassGroupFillOrder).map((group) => group.id)).toEqual(["a", "b"]);
  });
});
