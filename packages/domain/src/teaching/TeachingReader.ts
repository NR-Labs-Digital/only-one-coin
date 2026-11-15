import type { ClassGroupStatus, ClassroomLink, WeeklySlot } from "../catalog/ClassGroup.js";

/**
 * A class group as its teacher reads it in the docente portal: what it is,
 * when it meets, how full it is. No money, no waitlist, nothing of the
 * coordination's — and `teacherId`, which is what every check here compares
 * against the session (CLAUDE.md §8).
 *
 * Since OOC-156 what a teacher teaches is a module run of a class group (the
 * "sub-turma"): `id` is the run's, and the teaching fields — teacher,
 * schedule, module, Classroom — are the run's. Code, course, dates, seats and
 * status are the class group's (`classGroupId`). A run 0058 made from an
 * existing class group shares its id, so the portal's old addresses still open.
 */
export interface TeachingClassGroup {
  /** The module run's id — what the portal's address and the grade sheet name. */
  id: string;
  /** The class group the run belongs to: where the seats and the grades live. */
  classGroupId: string;
  /** Who the class group is allocated to (OOC-80); null = nobody yet. */
  teacherId: string | null;
  code: string;
  courseName: string;
  /** Catalog text, as the course carries it. */
  language: string;
  academicPeriodName: string;
  slots: WeeklySlot[];
  /** Null only on a draft. */
  startsOn: Date | null;
  endsOn: Date | null;
  /** The class group's, across every run. */
  capacity: number;
  /** The class group's, across every run (`students` on the run is in the roster). */
  seatsTaken: number;
  status: ClassGroupStatus;
  /** One Classroom per module it teaches (OOC-144, `classroomLinksOf`), in module order; empty = nobody pasted one yet. */
  classroomLinks: ClassroomLink[];
  /** Which of the course's modules it teaches (OOC-100), 1-based; null = coordination has not set it. */
  module: number | null;
  /**
   * That module's material link, from the course (OOC-94/OOC-100) — null when
   * there is none to open (`materialOfModule`).
   */
  moduleMaterialUrl: string | null;
  /** Teaches every module of the course (OOC-130); `module` is null then. */
  fullCourse: boolean;
  /** Every module's link, in order, on a full-course class group; empty on any other. */
  courseMaterialUrls: string[];
  /** The class group, or the run, retired from the catalog (`deleted_at`). */
  retired: boolean;
}

/** A class group as the grading reads it: where its grades go and whether they are open. */
export interface GradingClassGroup {
  id: string;
  status: ClassGroupStatus;
}

/**
 * One student as the teacher reads them: the name, never the document, the
 * contact or the money (the roster of OOC-71, narrowed). The port carries
 * nothing more, so no adapter can leak more than this.
 */
export interface TeachingStudent {
  enrollmentId: string;
  firstName: string;
  lastName: string;
}

/**
 * Read side of the teacher's own work. The adapter answers what it is asked
 * and decides nothing: whose class group it is, and whether it is still in the
 * portal, is the usecase's call (`teachingScope.ts`).
 */
export interface ITeachingReader {
  /** The module runs allocated to one teacher — every status, retired ones included. */
  listClassGroupsOf(teacherId: string): Promise<TeachingClassGroup[]>;
  /** One module run by id, whoever it is allocated to. */
  findClassGroup(classGroupModuleId: string): Promise<TeachingClassGroup | null>;
  /** The confirmed seats (OOC-55) in one module run now, in surname order. */
  listStudents(classGroupModuleId: string): Promise<TeachingStudent[]>;
  /** Confirmed seats across these module runs. */
  countStudents(classGroupModuleIds: string[]): Promise<number>;
  /** One class group, for the supervision's grade sheet (OOC-102). */
  findGradingClassGroup(classGroupId: string): Promise<GradingClassGroup | null>;
  /** Every confirmed seat of the class group, across its runs, in surname order. */
  listClassGroupStudents(classGroupId: string): Promise<TeachingStudent[]>;
}
