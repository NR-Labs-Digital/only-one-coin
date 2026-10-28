import { v7 as uuid } from "uuid";
import { z } from "zod";
import { SoftDeletableModel, SoftDeletableModelPropsSchema } from "../shared/base/SoftDeletableModel.js";
import {
  ClassGroupCourseLockedError,
  ClassGroupIncompleteError,
  ClassGroupModuleOutOfRangeError,
  ClassroomUrlInvalidError,
  InvalidDateRangeError,
  InvalidStatusTransitionError,
} from "./errors.js";

export const WeekdaySchema = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const HourMinute = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** One weekly session, in America/Lima — the shape the checkout already reads. */
export const WeeklySlotSchema = z
  .object({ weekday: WeekdaySchema, startTime: HourMinute, endTime: HourMinute })
  .refine((slot) => slot.startTime < slot.endTime);
export type WeeklySlot = z.infer<typeof WeeklySlotSchema>;

export const ClassGroupStatusSchema = z.enum(["draft", "enrolling", "in_progress", "finished", "closed"]);
export type ClassGroupStatus = z.infer<typeof ClassGroupStatusSchema>;

/**
 * The only way forward, one step at a time, moved by a person (OOC-35). No
 * step back: a class group opened by mistake is retired, not un-published.
 */
export const NEXT_CLASS_GROUP_STATUS: Record<ClassGroupStatus, ClassGroupStatus | null> = {
  draft: "enrolling",
  enrolling: "in_progress",
  in_progress: "finished",
  finished: "closed",
  closed: null,
};

const optionalDate = z.coerce.date().nullable().optional();

/**
 * The code a class group is born with: the sequence number behind `A-`, padded
 * to five digits and never cut past them. Nobody types or edits it — it is the
 * class group's stable name on paperwork, the teacher's portal and the grade
 * report. Course and period sit beside it on every screen, so it carries neither.
 */
export function classGroupCodeOf(sequence: number): string {
  return `A-${String(sequence).padStart(5, "0")}`;
}

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
 * The module a class group teaches is one of its course's (OOC-100). Checked
 * by the usecases, which hold the course: the class group alone does not know
 * how many modules there are. Null — no module set — always passes.
 */
export function assertModuleOfCourse(module: number | null, courseModules: number): void {
  if (module !== null && module > courseModules) throw new ClassGroupModuleOutOfRangeError();
}

export const ClassGroupPropsSchema = SoftDeletableModelPropsSchema.extend({
  courseId: z.string().uuid(),
  academicPeriodId: z.string().uuid(),
  code: z.string().trim(),
  /** The teacher running it (OOC-80). Null until somebody is allocated. */
  teacherId: z.string().uuid().nullable(),
  /**
   * The free-text name typed before teachers had a file (`class_groups.teacher_name`).
   * Read-only: nothing writes a new one, and allocating a teacher clears it —
   * it only stays as a hint on the class groups still waiting for a link.
   */
  legacyTeacherName: z.string(),
  /** Null until somebody pastes it. Not re-checked here: a row read back never throws. */
  classroomUrl: z.string().nullable(),
  /**
   * Which of the course's modules this class group teaches, 1-based (OOC-100)
   * — what picks the module material its teacher opens. Null on every class
   * group written before the column, and on one nobody set yet. The upper
   * bound is the course's module count, checked by the usecases that hold the
   * course; a row read back never throws.
   */
  module: z.number().int().positive().nullable(),
  slots: z.array(WeeklySlotSchema),
  startsOn: z.coerce.date().nullable(),
  endsOn: z.coerce.date().nullable(),
  enrollmentOpensAt: z.coerce.date().nullable(),
  enrollmentClosesAt: z.coerce.date().nullable(),
  capacity: z.number().int().positive(),
  seatsTaken: z.number().int().nonnegative(),
  status: ClassGroupStatusSchema,
  sourceClassGroupId: z.string().uuid().nullable(),
});
export type ClassGroupProps = z.infer<typeof ClassGroupPropsSchema>;

export const CreateClassGroupSchema = z.object({
  courseId: z.string().uuid(),
  academicPeriodId: z.string().uuid(),
  teacherId: z.string().uuid().nullable().optional(),
  classroomUrl: z.string().nullable().optional(),
  module: z.number().int().positive().nullable().optional(),
  slots: z.array(WeeklySlotSchema).min(1),
  capacity: z.number().int().positive(),
  startsOn: optionalDate,
  endsOn: optionalDate,
  enrollmentOpensAt: optionalDate,
  enrollmentClosesAt: optionalDate,
});
export type CreateClassGroupDTO = z.infer<typeof CreateClassGroupSchema>;

/** The period never changes — a class group in the wrong period is retired and reopened. */
export const UpdateClassGroupSchema = CreateClassGroupSchema.omit({ academicPeriodId: true }).partial();
export type UpdateClassGroupDTO = z.infer<typeof UpdateClassGroupSchema>;

type Editable = keyof UpdateClassGroupDTO;

export class ClassGroup extends SoftDeletableModel {
  public courseId: string;
  public readonly academicPeriodId: string;
  public readonly code: string;
  public teacherId: string | null;
  public legacyTeacherName: string;
  public classroomUrl: string | null;
  public module: number | null;
  public slots: WeeklySlot[];
  public startsOn: Date | null;
  public endsOn: Date | null;
  public enrollmentOpensAt: Date | null;
  public enrollmentClosesAt: Date | null;
  public capacity: number;
  /** Read-only here: only the atomic seat UPDATE in apps/api ever moves it (apps/api CLAUDE.md, Vagas). */
  public readonly seatsTaken: number;
  public status: ClassGroupStatus;
  public readonly sourceClassGroupId: string | null;

  constructor(props: ClassGroupProps) {
    super(props);
    this.courseId = props.courseId;
    this.academicPeriodId = props.academicPeriodId;
    this.code = props.code;
    this.teacherId = props.teacherId;
    this.legacyTeacherName = props.legacyTeacherName;
    this.classroomUrl = props.classroomUrl;
    this.module = props.module;
    this.slots = props.slots;
    this.startsOn = props.startsOn;
    this.endsOn = props.endsOn;
    this.enrollmentOpensAt = props.enrollmentOpensAt;
    this.enrollmentClosesAt = props.enrollmentClosesAt;
    this.capacity = props.capacity;
    this.seatsTaken = props.seatsTaken;
    this.status = props.status;
    this.sourceClassGroupId = props.sourceClassGroupId;
  }

  /**
   * Always born a draft; publishing is a separate, checked step. The code comes
   * from the repository's sequence (`classGroupCodeOf`), never from the DTO.
   */
  static create(dto: CreateClassGroupDTO, code: string): ClassGroup {
    const valid = CreateClassGroupSchema.parse(dto);
    const group = new ClassGroup(
      ClassGroupPropsSchema.parse({
        ...valid,
        id: uuid(),
        code,
        teacherId: valid.teacherId ?? null,
        legacyTeacherName: "",
        classroomUrl: normalizeClassroomUrl(valid.classroomUrl ?? null),
        module: valid.module ?? null,
        startsOn: valid.startsOn ?? null,
        endsOn: valid.endsOn ?? null,
        enrollmentOpensAt: valid.enrollmentOpensAt ?? null,
        enrollmentClosesAt: valid.enrollmentClosesAt ?? null,
        seatsTaken: 0,
        status: "draft",
        sourceClassGroupId: null,
      }),
    );
    group.assertConsistent();
    return group;
  }

  /**
   * Period duplication (OOC-35): same course, module, schedule, teacher and capacity;
   * no dates, no window, no seats, no Classroom link, a draft — and a pointer
   * back. Nothing that belongs to the old period's students comes along: their
   * Classroom is not the new group's (OOC-98). The copy is a new class group,
   * so it gets a code of its own — the same code in two periods would name two
   * groups.
   */
  static copyInto(source: ClassGroup, academicPeriodId: string, code: string): ClassGroup {
    return new ClassGroup(
      ClassGroupPropsSchema.parse({
        id: uuid(),
        courseId: source.courseId,
        academicPeriodId,
        code,
        teacherId: source.teacherId,
        legacyTeacherName: source.legacyTeacherName,
        classroomUrl: null,
        module: source.module,
        slots: source.slots,
        startsOn: null,
        endsOn: null,
        enrollmentOpensAt: null,
        enrollmentClosesAt: null,
        capacity: source.capacity,
        seatsTaken: 0,
        status: "draft",
        sourceClassGroupId: source.id,
      }),
    );
  }

  get isFull(): boolean {
    return this.seatsTaken >= this.capacity;
  }

  update(patch: UpdateClassGroupDTO): Editable[] {
    const valid = UpdateClassGroupSchema.parse(patch);
    const changed: Editable[] = [];

    if (valid.courseId !== undefined && valid.courseId !== this.courseId) {
      if (this.status !== "draft" || this.seatsTaken > 0) throw new ClassGroupCourseLockedError();
      this.courseId = valid.courseId;
      changed.push("courseId");
    }

    if (valid.teacherId !== undefined && valid.teacherId !== this.teacherId) {
      this.teacherId = valid.teacherId;
      // Somebody chose from the roster: the typed name has done its job.
      if (valid.teacherId !== null) this.legacyTeacherName = "";
      changed.push("teacherId");
    }

    if (valid.classroomUrl !== undefined) {
      const next = normalizeClassroomUrl(valid.classroomUrl);
      if (next !== this.classroomUrl) {
        this.classroomUrl = next;
        changed.push("classroomUrl");
      }
    }

    if (valid.module !== undefined && valid.module !== this.module) {
      this.module = valid.module;
      changed.push("module");
    }

    if (valid.capacity !== undefined && valid.capacity !== this.capacity) {
      this.capacity = valid.capacity;
      changed.push("capacity");
    }

    if (valid.slots !== undefined && JSON.stringify(valid.slots) !== JSON.stringify(this.slots)) {
      this.slots = valid.slots;
      changed.push("slots");
    }

    for (const key of ["startsOn", "endsOn", "enrollmentOpensAt", "enrollmentClosesAt"] as const) {
      const next = valid[key];
      if (next === undefined) continue;
      const current = this[key];
      if ((next?.getTime() ?? null) === (current?.getTime() ?? null)) continue;
      this[key] = next;
      changed.push(key);
    }

    this.assertConsistent();
    if (changed.length > 0) this.touch();
    return changed;
  }

  /** Moves one step forward. Answers the status it left. */
  advanceTo(next: ClassGroupStatus): ClassGroupStatus {
    if (NEXT_CLASS_GROUP_STATUS[this.status] !== next) throw new InvalidStatusTransitionError();
    const previous = this.status;
    this.status = next;
    this.assertConsistent();
    this.touch();
    return previous;
  }

  /**
   * What the 0018 checks also say — repeated here so the reader gets a
   * readable reason instead of a constraint name. Capacity vs seats taken is
   * NOT here: the seats move under us, so only the conditional UPDATE in the
   * repository can answer it truthfully.
   */
  private assertConsistent(): void {
    if (this.status !== "draft" && (this.startsOn === null || this.endsOn === null)) {
      throw new ClassGroupIncompleteError();
    }
    if (this.startsOn && this.endsOn && this.startsOn.getTime() >= this.endsOn.getTime()) {
      throw new InvalidDateRangeError();
    }
    if (
      this.enrollmentOpensAt &&
      this.enrollmentClosesAt &&
      this.enrollmentOpensAt.getTime() >= this.enrollmentClosesAt.getTime()
    ) {
      throw new InvalidDateRangeError();
    }
  }
}
