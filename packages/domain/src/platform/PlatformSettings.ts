import { z } from "zod";

/**
 * The numbers the backoffice may change without a deploy (OOC-41). Every
 * field here is read by something — the checkout, the receipt pipeline, the
 * review queue, grades, certificates, procedures or the teacher roster —
 * and never from a constant in code.
 */
export interface PlatformSettings {
  /** The short clock: a seat held at checkout until the receipt arrives. */
  checkoutHoldMinutes: number;
  /** How far ABOVE the expected amount a receipt is still green (OOC-21).
   * Never below — "Sem descontos. Nunca." (CLAUDE.md §1). */
  receiptAmountToleranceCents: number;
  /** Below this percentage of the expected amount, rejection is suggested
   * (OOC-21). 50 is provisional (owner, 03/10/2026). */
  receiptRejectBelowPercent: number;
  /** The long clock: receipt sent → decision. What the checkout promises and
   * the deadline Payments works to — one number (owner, 22/10/2026). */
  reviewWindowDays: number;
  /** Below this confidence (whole percent) a field the OCR read is flagged to
   * the reviewer; level 2 escalates on it once it exists (Sessão 29). */
  ocrLowConfidencePercent: number;
  /** Final grade needed to pass, on the 0–20 scale. */
  passingGrade: number;
  /** Business days the institution has to issue a certificate. */
  certificateDeadlineBusinessDays: number;
  /** Today's price of the constancia. A request freezes the value it was
   * asked at; changing this never reprices one already made. */
  constanciaFeeCents: number;
  /** How early a teacher's contract starts warning. 45 is provisional. */
  contractAlertDays: number;
}

export type PlatformSettingKey = keyof PlatformSettings;

/**
 * Bounds of each setting, mirrored by the CHECKs on `platform_settings`
 * (migrations 0014, 0020, 0021, 0032) and by the backoffice inputs. Whole
 * numbers only: cents, minutes, days, percent, grade points.
 */
export const PLATFORM_SETTING_BOUNDS = {
  // Five minutes is not enough for a bank transfer; past an hour the seat is
  // locked away from everybody else (docs/MATRICULA-CHECKOUT.md §3).
  checkoutHoldMinutes: { min: 5, max: 60 },
  // S/50, the ceiling the backoffice input already had.
  receiptAmountToleranceCents: { min: 0, max: 5000 },
  receiptRejectBelowPercent: { min: 1, max: 99 },
  reviewWindowDays: { min: 1, max: 30 },
  ocrLowConfidencePercent: { min: 50, max: 95 },
  passingGrade: { min: 0, max: 20 },
  certificateDeadlineBusinessDays: { min: 1, max: 90 },
  // S/1 to S/1,000: a procedure is paid (CLAUDE.md §1), never free.
  constanciaFeeCents: { min: 100, max: 100_000 },
  contractAlertDays: { min: 1, max: 180 },
} as const satisfies Record<PlatformSettingKey, { min: number; max: number }>;

export const PLATFORM_SETTING_KEYS = Object.keys(PLATFORM_SETTING_BOUNDS) as PlatformSettingKey[];

/** The column each setting lives in — also the audit trail's target id, so
 * a change reads the same in the log as in the database. */
export const PLATFORM_SETTING_COLUMNS: Record<PlatformSettingKey, string> = {
  checkoutHoldMinutes: "checkout_hold_minutes",
  receiptAmountToleranceCents: "receipt_amount_tolerance_cents",
  receiptRejectBelowPercent: "receipt_reject_below_percent",
  reviewWindowDays: "review_window_days",
  ocrLowConfidencePercent: "ocr_low_confidence_percent",
  passingGrade: "passing_grade",
  certificateDeadlineBusinessDays: "certificate_deadline_business_days",
  constanciaFeeCents: "constancia_fee_cents",
  contractAlertDays: "contract_alert_days",
};

export function platformSettingSchema(key: PlatformSettingKey) {
  const { min, max } = PLATFORM_SETTING_BOUNDS[key];
  return z.number().int().min(min).max(max);
}

/** A partial change: any subset of the settings, each within its bounds. */
export const PlatformSettingsChangesSchema = z
  .object(
    Object.fromEntries(PLATFORM_SETTING_KEYS.map((key) => [key, platformSettingSchema(key).optional()])) as {
      [K in PlatformSettingKey]: z.ZodOptional<z.ZodNumber>;
    },
  )
  .strict();

export type PlatformSettingsChanges = Partial<PlatformSettings>;
