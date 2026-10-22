import { InvalidPlatformSettingError, PLATFORM_SETTING_BOUNDS, UpdatePlatformSettingsUseCase } from "@ooc/domain";
import { describe, expect, it } from "vitest";
import { FakePlatformSettings, TEST_SETTINGS } from "./fakes/platformSettings.js";

/**
 * The one write path behind the settings screen (OOC-41): any subset of the
 * settings, each bounded, a no-op when unchanged, every change audited in the
 * same write. Replaces the three per-setting usecases of OOC-21/OOC-24.
 */

const run = (settings: FakePlatformSettings, changes: Record<string, number>) =>
  new UpdatePlatformSettingsUseCase(settings).run({ actorId: "staff-1", changes });

describe("UpdatePlatformSettingsUseCase", () => {
  it("writes only what changed, with one audit entry each, from and to", async () => {
    const settings = new FakePlatformSettings();

    const result = await run(settings, { receiptAmountToleranceCents: 50, passingGrade: 14, reviewWindowDays: 7 });

    expect(result).toEqual({ ...TEST_SETTINGS, receiptAmountToleranceCents: 50, reviewWindowDays: 7 });
    expect(settings.updates).toHaveLength(1);
    expect(settings.updates[0]!.changes).toEqual({ receiptAmountToleranceCents: 50, reviewWindowDays: 7 });
    expect(settings.updates[0]!.audit).toEqual([
      expect.objectContaining({
        actorId: "staff-1",
        action: "platform_settings.receipt_amount_tolerance_cents",
        targetId: "receipt_amount_tolerance_cents",
        metadata: { from: 0, to: 50 },
      }),
      expect.objectContaining({
        action: "platform_settings.review_window_days",
        targetId: "review_window_days",
        metadata: { from: 5, to: 7 },
      }),
    ]);
  });

  it("keeps the audit action names the trail already uses", async () => {
    const settings = new FakePlatformSettings();
    await run(settings, { checkoutHoldMinutes: 20, receiptRejectBelowPercent: 70 });

    expect(settings.updates[0]!.audit.map((entry) => entry.action)).toEqual([
      "platform_settings.checkout_hold_minutes",
      "platform_settings.receipt_reject_below_percent",
    ]);
  });

  it("writes and audits nothing when no value changes", async () => {
    const settings = new FakePlatformSettings();

    const result = await run(settings, { passingGrade: 14, constanciaFeeCents: 2500 });

    expect(result).toEqual(TEST_SETTINGS);
    expect(settings.updates).toEqual([]);
  });

  it.each(Object.entries(PLATFORM_SETTING_BOUNDS))("bounds %s to its range, whole numbers only", async (key, { min, max }) => {
    for (const value of [min - 1, max + 1, min + 0.5]) {
      const settings = new FakePlatformSettings();
      await expect(run(settings, { [key]: value })).rejects.toBeInstanceOf(InvalidPlatformSettingError);
      expect(settings.updates).toEqual([]);
    }
    const settings = new FakePlatformSettings();
    await run(settings, { [key]: min === TEST_SETTINGS[key as keyof typeof TEST_SETTINGS] ? max : min });
    expect(settings.updates).toHaveLength(1);
  });

  it("refuses the whole change when one value is out of range — never half a form", async () => {
    const settings = new FakePlatformSettings();

    await expect(run(settings, { reviewWindowDays: 7, passingGrade: 21 })).rejects.toBeInstanceOf(InvalidPlatformSettingError);
    expect(settings.updates).toEqual([]);
  });

  it("refuses a key that is not a setting", async () => {
    const settings = new FakePlatformSettings();

    await expect(run(settings, { maxStudents: 3 })).rejects.toBeInstanceOf(InvalidPlatformSettingError);
  });

  it("refuses a free constancia — a procedure is paid", async () => {
    await expect(run(new FakePlatformSettings(), { constanciaFeeCents: 0 })).rejects.toBeInstanceOf(InvalidPlatformSettingError);
  });
});
