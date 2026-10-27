import type { ClassGroupStatus, WeeklySlot } from "../catalog/ClassGroup.js";

/**
 * A class group as its teacher reads it in the docente portal: what it is,
 * when it meets, how full it is. No money, no waitlist, nothing of the
 * coordination's — and `teacherId`, which is what every check here compares
 * against the session (CLAUDE.md §8).
 */
export interface TeachingClassGroup {
  id: string;
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
  capacity: number;
  seatsTaken: number;
  status: ClassGroupStatus;
  /** The Google Classroom coordination pasted (OOC-98); null = nobody yet. */
  classroomUrl: string | null;
  /** Retired from the catalog (`deleted_at`). */
  retired: boolean;
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
  /** The class groups allocated to one teacher — every status, retired ones included. */
  listClassGroupsOf(teacherId: string): Promise<TeachingClassGroup[]>;
  /** One class group by id, whoever it is allocated to. */
  findClassGroup(classGroupId: string): Promise<TeachingClassGroup | null>;
  /** Confirmed seats only (OOC-55), in surname order. */
  listStudents(classGroupId: string): Promise<TeachingStudent[]>;
  /** Confirmed seats across these class groups. */
  countStudents(classGroupIds: string[]): Promise<number>;
}
