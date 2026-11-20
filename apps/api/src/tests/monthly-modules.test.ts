import { describe, expect, it } from "vitest";
import {
  hasClassAccess,
  monthlyAccessLock,
  monthlyAmountCents,
  purchasableModules,
  selectPrefix,
  type CoveredModule,
} from "@ooc/domain";

describe("monthly modules (OOC-86)", () => {
  it("offers the current attempt first, then the first attempt of every later module", () => {
    expect(purchasableModules({ current: { module: 2, attempt: 1 }, courseModules: 4, covered: [] })).toEqual([
      { module: 2, attempt: 1 },
      { module: 3, attempt: 1 },
      { module: 4, attempt: 1 },
    ]);
  });

  it("leaves out what is bought and alive, approved or waiting", () => {
    const covered: CoveredModule[] = [
      { module: 2, attempt: 1, status: "approved" },
      { module: 3, attempt: 1, status: "pending" },
    ];
    expect(purchasableModules({ current: { module: 2, attempt: 1 }, courseModules: 4, covered })).toEqual([
      { module: 4, attempt: 1 },
    ]);
  });

  it("a repeated module is bought again: the first attempt does not cover the second", () => {
    const covered: CoveredModule[] = [
      { module: 3, attempt: 1, status: "approved" },
      { module: 4, attempt: 1, status: "approved" },
    ];
    expect(purchasableModules({ current: { module: 3, attempt: 2 }, courseModules: 4, covered })).toEqual([
      { module: 3, attempt: 2 },
    ]);
  });

  it("nothing is for sale on the last module once it is bought", () => {
    const covered: CoveredModule[] = [{ module: 4, attempt: 1, status: "approved" }];
    expect(purchasableModules({ current: { module: 4, attempt: 1 }, courseModules: 4, covered })).toEqual([]);
  });

  it("the selection is a prefix of what is for sale", () => {
    const items = [
      { module: 2, attempt: 1 },
      { module: 3, attempt: 1 },
    ];
    expect(selectPrefix(items, 1)).toEqual([{ module: 2, attempt: 1 }]);
    expect(selectPrefix(items, 2)).toEqual(items);
    expect(selectPrefix(items, 0)).toBeNull();
    expect(selectPrefix(items, 3)).toBeNull();
    expect(selectPrefix(items, 1.5)).toBeNull();
  });

  it("the amount is the module price once per module, no discount", () => {
    expect(monthlyAmountCents(3, 12_000)).toBe(36_000);
  });

  it("only an approved purchase of the current attempt opens the class", () => {
    const current = { module: 2, attempt: 1 };
    expect(hasClassAccess(current, [{ module: 2, attempt: 1, status: "approved" }])).toBe(true);
    expect(hasClassAccess(current, [{ module: 2, attempt: 1, status: "under_review" }])).toBe(false);
    expect(hasClassAccess(current, [{ module: 3, attempt: 1, status: "approved" }])).toBe(false);
    expect(hasClassAccess({ module: 2, attempt: 2 }, [{ module: 2, attempt: 1, status: "approved" }])).toBe(false);
  });

  it("says whether the closed class waits for the student or for Pagos", () => {
    const current = { module: 2, attempt: 1 };
    expect(monthlyAccessLock(current, [])).toBe("monthly_payment_due");
    expect(monthlyAccessLock(current, [{ module: 2, attempt: 1, status: "pending" }])).toBe("monthly_payment_in_review");
    expect(monthlyAccessLock(current, [{ module: 2, attempt: 1, status: "approved" }])).toBeNull();
  });
});
