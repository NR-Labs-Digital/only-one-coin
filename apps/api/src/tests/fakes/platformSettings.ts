import type { AuditLogEntry, IPlatformSettingsRepository, PlatformSettings, PlatformSettingsChanges } from "@ooc/domain";

/** The column defaults of migrations 0014, 0020 and 0032. */
export const TEST_SETTINGS: PlatformSettings = {
  checkoutHoldMinutes: 15,
  receiptAmountToleranceCents: 0,
  receiptRejectBelowPercent: 50,
  reviewWindowDays: 5,
  ocrLowConfidencePercent: 75,
  passingGrade: 14,
  certificateDeadlineBusinessDays: 25,
  constanciaFeeCents: 2500,
  contractAlertDays: 45,
};

/** In-memory `platform_settings`: reads what the last update wrote. */
export class FakePlatformSettings implements IPlatformSettingsRepository {
  updates: { changes: PlatformSettingsChanges; actorId: string; audit: AuditLogEntry[] }[] = [];

  constructor(public current: PlatformSettings = TEST_SETTINGS) {}

  get(): Promise<PlatformSettings> {
    return Promise.resolve(this.current);
  }

  update(params: { changes: PlatformSettingsChanges; actorId: string; audit: AuditLogEntry[] }): Promise<void> {
    this.updates.push(params);
    this.current = { ...this.current, ...params.changes };
    return Promise.resolve();
  }
}
