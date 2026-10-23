import type { AuditLogEntry } from "../../identity/ports/IAuditLogRepository.js";
import type { PlatformSettings, PlatformSettingsChanges } from "../PlatformSettings.js";

/**
 * One row, read on every checkout hold, receipt validation and every screen
 * that runs on a platform rule. A write touches only the columns that changed,
 * so saving one setting can never carry a stale copy of another along with it.
 */
export interface IPlatformSettingsRepository {
  get(): Promise<PlatformSettings>;
  /** One transaction: the changed columns and one audit entry each. */
  update(params: { changes: PlatformSettingsChanges; actorId: string; audit: AuditLogEntry[] }): Promise<void>;
}
