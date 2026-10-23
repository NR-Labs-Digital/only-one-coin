import type { Role } from "@ooc/domain";

/**
 * Who reads the platform settings (OOC-41): every staff cargo. The numbers
 * are not sensitive, and the screens that run on them — grades, certificates,
 * teacher contracts, the review queue — belong to every cargo in the panel.
 * Students and guardians never read them here.
 */
export const SETTINGS_READ_ROLES = [
  "master",
  "admin",
  "analyst",
  "enrollment_supervisor",
  "academic_supervisor",
  "teacher",
  "sales",
  "support",
  "billing",
] as const satisfies readonly Role[];

/** Who changes them — the settings screen's cargos (`canConfigureSettings`). */
export const SETTINGS_WRITE_ROLES = ["master", "admin"] as const satisfies readonly Role[];
