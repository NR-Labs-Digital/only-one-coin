import { v7 as uuid } from "uuid";
import { z } from "zod";
import { SoftDeletableModel, SoftDeletableModelPropsSchema } from "../shared/base/SoftDeletableModel.js";
import {
  applyClassroomLinks,
  ClassroomLinkPatchSchema,
  sameLinks,
  WeeklySlotSchema,
  type ClassroomLinks,
  type WeeklySlot,
} from "./classGroupTeaching.js";

/**
 * A module run of a class group — the "sub-turma" (OOC-156, decisions of
 * 14/11/2026). The class group is what is sold: course, period, code, dates,
 * capacity and the seats, counted across every run. The run is where the class
 * happens: its own schedule, teacher and Classroom. The runs of one class
 * group go on at the same time — students in module 1 and module 2 side by
 * side — and a new student always starts in the first one (`entryModule`).
 *
 * The fields are the teaching fields the class group carried until now, with
 * the same meaning, so the rules over them (`classroomLinksOf`,
 * `taughtModules`, the module material) read a run unchanged:
 *
 * - `module`: which of the course's modules it teaches, 1-based. Null when
 *   nobody set it (every class group made before OOC-100) or on a full course.
 * - `fullCourse`: it teaches every module of the course (OOC-130).
 *
 * A run with no module number — the full-course one or the unset one — is
 * alone in its class group (`ClassGroup.assertModulesConsistent`).
 */
export const ClassGroupModulePropsSchema = SoftDeletableModelPropsSchema.extend({
  classGroupId: z.string().uuid(),
  module: z.number().int().positive().nullable(),
  fullCourse: z.boolean(),
  /** The teacher running it (OOC-80). Null until somebody is allocated. */
  teacherId: z.string().uuid().nullable(),
  /**
   * The free-text name of a class group typed before teachers had a file.
   * Read-only: nothing writes a new one, and allocating a teacher clears it.
   */
  legacyTeacherName: z.string(),
  slots: z.array(WeeklySlotSchema),
  /** One Classroom per module it teaches (OOC-144). Not re-checked here: a row read back never throws. */
  classroomLinks: z.record(z.string(), z.string()),
  /** OOC-98's single link, read only for a run with no module set (`classroomLinksOf`). */
  classroomUrl: z.string().nullable(),
});
export type ClassGroupModuleProps = z.infer<typeof ClassGroupModulePropsSchema>;

/** What coordination sets on a run. */
export const CreateClassGroupModuleSchema = z.object({
  teacherId: z.string().uuid().nullable().optional(),
  /** Per-module links to set or clear (OOC-144); modules not named keep theirs. */
  classroomLinks: z.array(ClassroomLinkPatchSchema).max(50).optional(),
  module: z.number().int().positive().nullable().optional(),
  /** Wins over `module`: the whole course is not one of its modules. */
  fullCourse: z.boolean().optional(),
  slots: z.array(WeeklySlotSchema).min(1),
});
export type CreateClassGroupModuleDTO = z.infer<typeof CreateClassGroupModuleSchema>;

export const UpdateClassGroupModuleSchema = CreateClassGroupModuleSchema.partial();
export type UpdateClassGroupModuleDTO = z.infer<typeof UpdateClassGroupModuleSchema>;

export type ClassGroupModuleField = "teacherId" | "classroomLinks" | "module" | "fullCourse" | "slots";

export class ClassGroupModule extends SoftDeletableModel {
  public readonly classGroupId: string;
  public module: number | null;
  public fullCourse: boolean;
  public teacherId: string | null;
  public legacyTeacherName: string;
  public slots: WeeklySlot[];
  public classroomLinks: ClassroomLinks;
  public readonly classroomUrl: string | null;

  constructor(props: ClassGroupModuleProps) {
    super(props);
    this.classGroupId = props.classGroupId;
    this.module = props.module;
    this.fullCourse = props.fullCourse;
    this.teacherId = props.teacherId;
    this.legacyTeacherName = props.legacyTeacherName;
    this.slots = props.slots;
    this.classroomLinks = props.classroomLinks;
    this.classroomUrl = props.classroomUrl;
  }

  static create(classGroupId: string, dto: CreateClassGroupModuleDTO): ClassGroupModule {
    const valid = CreateClassGroupModuleSchema.parse(dto);
    return new ClassGroupModule(
      ClassGroupModulePropsSchema.parse({
        id: uuid(),
        classGroupId,
        module: valid.fullCourse ? null : (valid.module ?? null),
        fullCourse: valid.fullCourse ?? false,
        teacherId: valid.teacherId ?? null,
        legacyTeacherName: "",
        slots: valid.slots,
        classroomLinks: applyClassroomLinks({}, valid.classroomLinks ?? []),
        classroomUrl: null,
      }),
    );
  }

  /**
   * Period duplication (OOC-35): same module, schedule and teacher; no
   * Classroom — the old period's Classrooms are its students' (OOC-98, OOC-144).
   */
  static copyInto(source: ClassGroupModule, classGroupId: string): ClassGroupModule {
    return new ClassGroupModule(
      ClassGroupModulePropsSchema.parse({
        id: uuid(),
        classGroupId,
        module: source.module,
        fullCourse: source.fullCourse,
        teacherId: source.teacherId,
        legacyTeacherName: source.legacyTeacherName,
        slots: source.slots,
        classroomLinks: {},
        classroomUrl: null,
      }),
    );
  }

  /** No module number: the full-course run or the one nobody set — either is alone in its class group. */
  get isUnnumbered(): boolean {
    return this.module === null;
  }

  update(patch: UpdateClassGroupModuleDTO): ClassGroupModuleField[] {
    const valid = UpdateClassGroupModuleSchema.parse(patch);
    const changed: ClassGroupModuleField[] = [];

    if (valid.teacherId !== undefined && valid.teacherId !== this.teacherId) {
      this.teacherId = valid.teacherId;
      // Somebody chose from the roster: the typed name has done its job.
      if (valid.teacherId !== null) this.legacyTeacherName = "";
      changed.push("teacherId");
    }

    if (valid.classroomLinks !== undefined) {
      const next = applyClassroomLinks(this.classroomLinks, valid.classroomLinks);
      if (!sameLinks(next, this.classroomLinks)) {
        this.classroomLinks = next;
        changed.push("classroomLinks");
      }
    }

    // One or the other: picking a module ends "full course", and the reverse.
    const fullCourse = valid.fullCourse ?? (valid.module ? false : this.fullCourse);
    const module = fullCourse ? null : valid.module !== undefined ? valid.module : this.module;
    if (fullCourse !== this.fullCourse) {
      this.fullCourse = fullCourse;
      changed.push("fullCourse");
    }
    if (module !== this.module) {
      this.module = module;
      changed.push("module");
    }

    if (valid.slots !== undefined && JSON.stringify(valid.slots) !== JSON.stringify(this.slots)) {
      this.slots = valid.slots;
      changed.push("slots");
    }

    if (changed.length > 0) this.touch();
    return changed;
  }
}
