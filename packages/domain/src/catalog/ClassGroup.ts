import { v7 as uuid } from "uuid";
import { z } from "zod";
import { SoftDeletableModel, SoftDeletableModelPropsSchema } from "../shared/base/SoftDeletableModel.js";
import { ClassGroupModule, CreateClassGroupModuleSchema, type CreateClassGroupModuleDTO } from "./ClassGroupModule.js";
import {
  ClassGroupCourseLockedError,
  ClassGroupIncompleteError,
  ClassGroupLastModuleError,
  ClassGroupModuleAloneError,
  ClassGroupModuleNotFoundError,
  ClassGroupModuleTakenError,
  InvalidDateRangeError,
  InvalidStatusTransitionError,
} from "./errors.js";

// The teaching rules moved beside the module runs (OOC-156); re-exported so
// every import of them from here keeps working.
export {
  applyClassroomLinks,
  assertClassroomLinksOfCourse,
  assertModuleOfCourse,
  CLASSROOM_HOST,
  ClassroomLinkPatchSchema,
  classroomLinksOf,
  isMissingClassroom,
  MEET_HOST,
  normalizeClassroomUrl,
  normalizeMeetUrl,
  sameLinks,
  taughtModules,
  WeekdaySchema,
  WeeklySlotSchema,
  type ClassroomLink,
  type ClassroomLinkPatch,
  type ClassroomLinks,
  type ClassroomSource,
  type WeeklySlot,
} from "./classGroupTeaching.js";

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
 * The class group — the "turma" (OOC-156). What is sold lives here: course,
 * period, code, dates, enrollment window, capacity and the seats, counted
 * across every module run. Where and when the class happens lives on the runs
 * (`ClassGroupModule`), which this aggregate owns: their rules — one run per
 * module, the full-course or unset run alone — are checked here.
 */
export const ClassGroupPropsSchema = SoftDeletableModelPropsSchema.extend({
  courseId: z.string().uuid(),
  academicPeriodId: z.string().uuid(),
  code: z.string().trim(),
  startsOn: z.coerce.date().nullable(),
  endsOn: z.coerce.date().nullable(),
  enrollmentOpensAt: z.coerce.date().nullable(),
  enrollmentClosesAt: z.coerce.date().nullable(),
  capacity: z.number().int().positive(),
  seatsTaken: z.number().int().nonnegative(),
  /** Seats held above capacity (OOC-155). Optional so readers that predate it read 0. */
  seatsOver: z.number().int().nonnegative().optional(),
  status: ClassGroupStatusSchema,
  sourceClassGroupId: z.string().uuid().nullable(),
});
export type ClassGroupProps = z.infer<typeof ClassGroupPropsSchema>;

/**
 * Opening a class group opens its first module run with it — the fields the
 * form always asked for (teacher, module, schedule, Classroom). More runs are
 * added afterwards (`ClassGroup.addModule`).
 */
export const CreateClassGroupSchema = CreateClassGroupModuleSchema.extend({
  courseId: z.string().uuid(),
  academicPeriodId: z.string().uuid(),
  capacity: z.number().int().positive(),
  startsOn: optionalDate,
  endsOn: optionalDate,
  enrollmentOpensAt: optionalDate,
  enrollmentClosesAt: optionalDate,
});
export type CreateClassGroupDTO = z.infer<typeof CreateClassGroupSchema>;

/**
 * The class group's own fields. The period never changes — a class group in
 * the wrong period is retired and reopened. A run's fields are edited on the
 * run (`UpdateClassGroupModuleSchema`).
 */
export const UpdateClassGroupSchema = z
  .object({
    courseId: z.string().uuid(),
    capacity: z.number().int().positive(),
    startsOn: optionalDate,
    endsOn: optionalDate,
    enrollmentOpensAt: optionalDate,
    enrollmentClosesAt: optionalDate,
  })
  .partial();
export type UpdateClassGroupDTO = z.infer<typeof UpdateClassGroupSchema>;

type Editable = keyof UpdateClassGroupDTO;

function moduleOrder(a: ClassGroupModule, b: ClassGroupModule): number {
  return (a.module ?? 0) - (b.module ?? 0) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}

export class ClassGroup extends SoftDeletableModel {
  public courseId: string;
  public readonly academicPeriodId: string;
  public readonly code: string;
  public startsOn: Date | null;
  public endsOn: Date | null;
  public enrollmentOpensAt: Date | null;
  public enrollmentClosesAt: Date | null;
  public capacity: number;
  /** Read-only here: only the atomic seat UPDATE in apps/api ever moves it (apps/api CLAUDE.md, Vagas). */
  public readonly seatsTaken: number;
  /** Same: only the atomic seat UPDATEs move it (OOC-155). */
  public readonly seatsOver: number;
  public status: ClassGroupStatus;
  public readonly sourceClassGroupId: string | null;
  /** Every run loaded with it, retired ones included; `modules` is the live ones. */
  private readonly runs: ClassGroupModule[];

  constructor(props: ClassGroupProps, modules: ClassGroupModule[] = []) {
    super(props);
    this.courseId = props.courseId;
    this.academicPeriodId = props.academicPeriodId;
    this.code = props.code;
    this.startsOn = props.startsOn;
    this.endsOn = props.endsOn;
    this.enrollmentOpensAt = props.enrollmentOpensAt;
    this.enrollmentClosesAt = props.enrollmentClosesAt;
    this.capacity = props.capacity;
    this.seatsTaken = props.seatsTaken;
    this.seatsOver = props.seatsOver ?? 0;
    this.status = props.status;
    this.sourceClassGroupId = props.sourceClassGroupId;
    this.runs = [...modules];
  }

  /**
   * Always born a draft; publishing is a separate, checked step. The code comes
   * from the repository's sequence (`classGroupCodeOf`), never from the DTO.
   * The first module run is born with it.
   */
  static create(dto: CreateClassGroupDTO, code: string, courseModules = 1): ClassGroup {
    const valid = CreateClassGroupSchema.parse(dto);
    const id = uuid();
    // A full course is one run per module of the course (OOC-156), with the
    // same teacher and week in each and each module's own Classroom.
    const modules = valid.fullCourse
      ? Array.from({ length: Math.max(1, courseModules) }, (_, index) => index + 1)
      : [valid.module ?? null];
    const group = new ClassGroup(
      ClassGroupPropsSchema.parse({
        id,
        courseId: valid.courseId,
        academicPeriodId: valid.academicPeriodId,
        code,
        startsOn: valid.startsOn ?? null,
        endsOn: valid.endsOn ?? null,
        enrollmentOpensAt: valid.enrollmentOpensAt ?? null,
        enrollmentClosesAt: valid.enrollmentClosesAt ?? null,
        capacity: valid.capacity,
        seatsTaken: 0,
        status: "draft",
        sourceClassGroupId: null,
      }),
      modules.map((module) =>
        ClassGroupModule.create(id, {
          teacherId: valid.teacherId,
          classroomLinks:
            module === null || !valid.fullCourse
              ? valid.classroomLinks
              : valid.classroomLinks?.filter((link) => link.module === module),
          // A Meet is one module group's (OOC-159): a full course splits into
          // a run per module, and which Meet each one uses is pasted per run.
          meetUrl: valid.fullCourse ? null : valid.meetUrl,
          module,
          slots: valid.slots,
        }),
      ),
    );
    group.assertConsistent();
    return group;
  }

  /**
   * Period duplication (OOC-35): same course, capacity and module runs (module,
   * schedule, teacher); no dates, no window, no seats, no Classroom links, a
   * draft — and a pointer back. Nothing that belongs to the old period's
   * students comes along: their Classrooms are not the new group's (OOC-98,
   * OOC-144). The copy is a new class group, so it gets a code of its own —
   * the same code in two periods would name two groups.
   */
  static copyInto(source: ClassGroup, academicPeriodId: string, code: string): ClassGroup {
    const id = uuid();
    return new ClassGroup(
      ClassGroupPropsSchema.parse({
        id,
        courseId: source.courseId,
        academicPeriodId,
        code,
        startsOn: null,
        endsOn: null,
        enrollmentOpensAt: null,
        enrollmentClosesAt: null,
        capacity: source.capacity,
        seatsTaken: 0,
        status: "draft",
        sourceClassGroupId: source.id,
      }),
      source.modules.map((run) => ClassGroupModule.copyInto(run, id)),
    );
  }

  /** The live module runs, in module order. */
  get modules(): ClassGroupModule[] {
    return this.runs.filter((run) => !run.isDeleted).sort(moduleOrder);
  }

  /**
   * Where a new student starts (OOC-156, owner's decision: always module 1) —
   * the lowest live run, which is module 1 whenever the class group has one.
   * A class group with a single run of another module, a full course or an
   * unset module keeps selling into that run, as it did before runs existed.
   * Null only for a class group with no live run, which sells nothing.
   */
  get entryModule(): ClassGroupModule | null {
    return this.modules[0] ?? null;
  }

  moduleById(id: string): ClassGroupModule {
    const run = this.modules.find((candidate) => candidate.id === id);
    if (!run) throw new ClassGroupModuleNotFoundError();
    return run;
  }

  /** Opens another module run; the caller has checked the module against the course and the teacher against the roster. */
  addModule(dto: CreateClassGroupModuleDTO): ClassGroupModule {
    const run = ClassGroupModule.create(this.id, dto);
    this.runs.push(run);
    try {
      this.assertModulesConsistent();
    } catch (error) {
      // A refused run never joins the aggregate.
      this.runs.pop();
      throw error;
    }
    return run;
  }

  /**
   * Retires a run. The last one stays: a class group with no run has nowhere
   * to teach nor to put a new student. Whether students are still in it is
   * the repository's conditional write — they move under us.
   */
  retireModule(id: string, at: Date = new Date()): ClassGroupModule {
    const run = this.moduleById(id);
    if (this.modules.length === 1) throw new ClassGroupLastModuleError();
    run.softDelete(at);
    return run;
  }

  /**
   * One run per module, and a run with no module number — the full course or
   * the unset one — alone: the full course already teaches every module, and
   * an unset run says nothing about which module the next one would follow.
   * The partial unique indexes of 0058 say the same under a race.
   */
  assertModulesConsistent(): void {
    const live = this.modules;
    if (live.some((run) => run.isUnnumbered) && live.length > 1) throw new ClassGroupModuleAloneError();
    const numbers = live.map((run) => run.module);
    if (new Set(numbers).size !== numbers.length) throw new ClassGroupModuleTakenError();
  }

  /**
   * Whether one run may teach `module` (null: a full course or unset) beside
   * the others — the same rule, asked before the run changes so a refusal
   * leaves it as it was.
   */
  assertRunCanTeach(runId: string, module: number | null): void {
    const others = this.modules.filter((run) => run.id !== runId);
    if (others.length > 0 && (module === null || others.some((run) => run.isUnnumbered))) {
      throw new ClassGroupModuleAloneError();
    }
    if (module !== null && others.some((run) => run.module === module)) throw new ClassGroupModuleTakenError();
  }

  get isFull(): boolean {
    // A seat above capacity is still a seat (OOC-155): 30/30 +2 that got one
    // regular seat back is still full.
    return this.seatsTaken + this.seatsOver >= this.capacity;
  }

  update(patch: UpdateClassGroupDTO): Editable[] {
    const valid = UpdateClassGroupSchema.parse(patch);
    const changed: Editable[] = [];

    if (valid.courseId !== undefined && valid.courseId !== this.courseId) {
      if (this.status !== "draft" || this.seatsTaken + this.seatsOver > 0) throw new ClassGroupCourseLockedError();
      this.courseId = valid.courseId;
      changed.push("courseId");
    }

    if (valid.capacity !== undefined && valid.capacity !== this.capacity) {
      this.capacity = valid.capacity;
      changed.push("capacity");
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
