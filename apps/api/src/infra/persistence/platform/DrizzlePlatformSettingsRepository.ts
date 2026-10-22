import { auditLog, platformSettings } from "@ooc/db";
import type { AuditLogEntry, IPlatformSettingsRepository, PlatformSettings, PlatformSettingsChanges } from "@ooc/domain";
import { sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

/**
 * Migration 0014 inserts the one row; the defaults below answer only if it
 * was somehow never there, and they are the column defaults of migrations
 * 0014, 0020 and 0032 — reading settings must never be the thing that takes
 * the checkout down.
 */
const DEFAULTS: PlatformSettings = {
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

export class DrizzlePlatformSettingsRepository implements IPlatformSettingsRepository {
  constructor(private readonly db: Db) {}

  async get(): Promise<PlatformSettings> {
    const [row] = await this.db
      .select({
        checkoutHoldMinutes: platformSettings.checkoutHoldMinutes,
        receiptAmountToleranceCents: platformSettings.receiptAmountToleranceCents,
        receiptRejectBelowPercent: platformSettings.receiptRejectBelowPercent,
        reviewWindowDays: platformSettings.reviewWindowDays,
        ocrLowConfidencePercent: platformSettings.ocrLowConfidencePercent,
        passingGrade: platformSettings.passingGrade,
        certificateDeadlineBusinessDays: platformSettings.certificateDeadlineBusinessDays,
        constanciaFeeCents: platformSettings.constanciaFeeCents,
        contractAlertDays: platformSettings.contractAlertDays,
      })
      .from(platformSettings)
      .limit(1);

    return row ?? DEFAULTS;
  }

  /**
   * Only the changed columns, and the audit entries in the same transaction:
   * a setting that moved always says who moved it. Upsert against the
   * singleton key, so a missing row is created rather than the write
   * silently matching nothing.
   */
  async update(params: { changes: PlatformSettingsChanges; actorId: string; audit: AuditLogEntry[] }): Promise<void> {
    const { changes, actorId, audit } = params;

    await this.db.transaction(async (tx) => {
      await tx
        .insert(platformSettings)
        .values({ id: true, ...changes, updatedBy: actorId })
        .onConflictDoUpdate({
          target: platformSettings.id,
          set: { ...changes, updatedBy: actorId, updatedAt: sql`now()` },
        });

      if (audit.length > 0) {
        await tx.insert(auditLog).values(
          audit.map((entry) => ({
            actorId: entry.actorId,
            action: entry.action,
            targetId: entry.targetId,
            metadata: entry.metadata ?? null,
            createdAt: entry.at,
          })),
        );
      }
    });
  }
}
