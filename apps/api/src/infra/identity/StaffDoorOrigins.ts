import type { Role } from "@ooc/domain";

/**
 * The public origins of the two staff doors (apps/app/CLAUDE.md, "Três
 * domínios, um deploy"): the panel, and the teacher portal on its own domain.
 * Cookies are per host, so a link that starts a session (invite, password
 * reset) has to open on the door the account will use.
 */
export interface StaffDoorOrigins {
  backoffice: string;
  teacher: string;
}

export function staffDoorOrigin(origins: StaffDoorOrigins, role: Role): string {
  return role === "teacher" ? origins.teacher : origins.backoffice;
}
