import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { AuditLogEntry } from "../identity/ports/IAuditLogRepository.js";
import {
  PLATFORM_SETTING_COLUMNS,
  PLATFORM_SETTING_KEYS,
  PlatformSettingsChangesSchema,
  type PlatformSettings,
  type PlatformSettingsChanges,
} from "./PlatformSettings.js";
import { InvalidPlatformSettingError } from "./errors.js";
import type { IPlatformSettingsRepository } from "./ports/IPlatformSettingsRepository.js";

export interface UpdatePlatformSettingsInput {
  actorId: string;
  changes: PlatformSettingsChanges;
}

/**
 * Changes any subset of the platform settings (OOC-41) — the one write path
 * behind the settings screen. Every value is checked against its bounds
 * before anything is written; one out of range refuses the whole change, so
 * the screen never saves half a form.
 *
 * Each value that actually changed gets its own audit entry
 * (`platform_settings.<column>`, from → to), in the same transaction as the
 * write. These numbers decide what a receipt's verdict is, who passes and how
 * long a seat waits — who moved them is part of the record. A value equal to
 * the current one is no change and leaves no trail.
 *
 * Applies from the next read: a verdict, a hold or a deadline already
 * computed keeps the number it was computed with.
 */
export class UpdatePlatformSettingsUseCase extends BaseUseCase<UpdatePlatformSettingsInput, PlatformSettings> {
  constructor(private readonly settings: IPlatformSettingsRepository) {
    super();
  }

  async run(input: UpdatePlatformSettingsInput): Promise<PlatformSettings> {
    const parsed = PlatformSettingsChangesSchema.safeParse(input.changes);
    if (!parsed.success) {
      throw new InvalidPlatformSettingError({ path: parsed.error.issues[0]?.path.join(".") });
    }

    const before = await this.settings.get();
    const changes: PlatformSettingsChanges = {};
    const audit: AuditLogEntry[] = [];
    const at = new Date();

    for (const key of PLATFORM_SETTING_KEYS) {
      const value = parsed.data[key];
      if (value === undefined || value === before[key]) continue;
      changes[key] = value;
      audit.push({
        actorId: input.actorId,
        action: `platform_settings.${PLATFORM_SETTING_COLUMNS[key]}`,
        targetId: PLATFORM_SETTING_COLUMNS[key],
        metadata: { from: before[key], to: value },
        at,
      });
    }

    if (audit.length === 0) return before;

    await this.settings.update({ changes, actorId: input.actorId, audit });
    return { ...before, ...changes };
  }
}
