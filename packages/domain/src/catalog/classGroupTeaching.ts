import { z } from "zod";
import { ClassGroupModuleOutOfRangeError, ClassroomUrlInvalidError, MeetUrlInvalidError } from "./errors.js";

/**
 * The teaching side of a class group — when it meets and where (Classroom) —
 * shared by the class group's DTOs and its module runs (`ClassGroupModule`,
 * OOC-156), which now carry these fields. Kept apart so neither file imports
 * the other.
 */

export const WeekdaySchema = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const HourMinute = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** One weekly session, in America/Lima — the shape the checkout already reads. */
export const WeeklySlotSchema = z
  .object({ weekday: WeekdaySchema, startTime: HourMinute, endTime: HourMinute })
  .refine((slot) => slot.startTime < slot.endTime);
export type WeeklySlot = z.infer<typeof WeeklySlotSchema>;

/**
 * Where the class happens (OOC-98): the Google Classroom coordination pastes
 * for the class group. The link ends up as an href on the teacher's and the
 * student's screens, so anything but https on this host is refused.
 */
export const CLASSROOM_HOST = "classroom.google.com";

/** The link normalized, null when left blank — or a refusal. */
export function normalizeClassroomUrl(raw: string | null): string | null {
  const value = raw?.trim() ?? "";
  if (value === "") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new ClassroomUrlInvalidError({ cause });
  }
  if (url.protocol !== "https:" || url.hostname !== CLASSROOM_HOST) throw new ClassroomUrlInvalidError();
  return url.toString();
}

/**
 * The Google Meet of a module group (OOC-159), pasted by coordination next to
 * its Classroom. One per module group — since 0059 every run teaches a single
 * module, so there is no per-module map as with the Classroom. Ends up as an
 * href on the student's and the teacher's screens: https on this host only.
 */
export const MEET_HOST = "meet.google.com";

/** The link normalized, null when left blank — or a refusal. */
export function normalizeMeetUrl(raw: string | null): string | null {
  const value = raw?.trim() ?? "";
  if (value === "") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new MeetUrlInvalidError({ cause });
  }
  if (url.protocol !== "https:" || url.hostname !== MEET_HOST) throw new MeetUrlInvalidError();
  return url.toString();
}

/**
 * One Google Classroom per module the class group teaches (OOC-144): module
 * number → link. JSON keys are text, so the number is too. Replaces the one
 * link per class group of OOC-98 (`classroomUrl`), which only a class group
 * with no module set still reads. A module the group no longer teaches keeps
 * its link — progression (OOC-85) moves the group on, and that Classroom is
 * still that module's.
 */
export type ClassroomLinks = Record<string, string>;

/** One module's link to set, or to clear with `url: null`. */
export const ClassroomLinkPatchSchema = z.object({
  module: z.number().int().positive(),
  url: z.string().max(2048).nullable(),
});
export type ClassroomLinkPatch = z.infer<typeof ClassroomLinkPatchSchema>;

/** A quick link as teacher and student read it. `module` is null only for the legacy link of a class group with no module set. */
export interface ClassroomLink {
  module: number | null;
  url: string;
}

export type ClassroomSource = {
  module: number | null;
  fullCourse: boolean;
  classroomLinks: ClassroomLinks;
  classroomUrl: string | null;
};

/** The modules a class group teaches: its one, every module of the course on a full course, none while unset. */
export function taughtModules(group: Pick<ClassroomSource, "module" | "fullCourse">, courseModules: number): number[] {
  if (group.fullCourse) return Array.from({ length: courseModules }, (_, i) => i + 1);
  return group.module === null ? [] : [group.module];
}

/**
 * The Classroom links of the modules the class group teaches, in module order
 * — what its teacher and its confirmed students open. A class group with no
 * module set has nothing to key a link by, so it falls back to the one link
 * pasted before OOC-144 (`classroomUrl`), with no module.
 */
export function classroomLinksOf(group: ClassroomSource, courseModules: number): ClassroomLink[] {
  if (!group.fullCourse && group.module === null) {
    return group.classroomUrl ? [{ module: null, url: group.classroomUrl }] : [];
  }
  return taughtModules(group, courseModules).flatMap((module) => {
    const url = group.classroomLinks[String(module)];
    return url ? [{ module, url }] : [];
  });
}

/** Some module it teaches still has no Classroom — the list's "Sin Classroom" warning. Warns, never blocks. */
export function isMissingClassroom(group: ClassroomSource, courseModules: number): boolean {
  if (!group.fullCourse && group.module === null) return group.classroomUrl === null;
  return taughtModules(group, courseModules).some((module) => !group.classroomLinks[String(module)]);
}

/**
 * A link can only be set for one of the course's modules. Clearing one is
 * always allowed — a course cut to fewer modules must still let coordination
 * tidy up the links of the modules it lost.
 */
export function assertClassroomLinksOfCourse(patches: ClassroomLinkPatch[] | undefined, courseModules: number): void {
  if (patches?.some((patch) => patch.url !== null && patch.url.trim() !== "" && patch.module > courseModules)) {
    throw new ClassGroupModuleOutOfRangeError();
  }
}

/** The links with the patches applied, each link normalized; a blank one clears its module. */
export function applyClassroomLinks(current: ClassroomLinks, patches: ClassroomLinkPatch[]): ClassroomLinks {
  const next: ClassroomLinks = { ...current };
  for (const patch of patches) {
    const url = normalizeClassroomUrl(patch.url);
    if (url) next[String(patch.module)] = url;
    else delete next[String(patch.module)];
  }
  return next;
}

export function sameLinks(a: ClassroomLinks, b: ClassroomLinks): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/**
 * The module a class group teaches is one of its course's (OOC-100). Checked
 * by the usecases, which hold the course: the class group alone does not know
 * how many modules there are. Null — no module set — always passes.
 */
export function assertModuleOfCourse(module: number | null, courseModules: number): void {
  if (module !== null && module > courseModules) throw new ClassGroupModuleOutOfRangeError();
}

