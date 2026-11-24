import type { AuditLogEntry } from "../identity/ports/IAuditLogRepository.js";
import type { EmailNotification } from "../notification/EmailNotification.js";
import type { GradeEmailFacts } from "../notification/gradeEmails.js";
import type { GradeValue } from "./Grade.js";

/**
 * The grade register (OOC-180, client request; decisions of 23/11/2026 with
 * Miguel — to confirm with the owner). A module run's grades for one round of
 * the module: the teacher posts them, may still change them, and sends the
 * register to review; coordination returns it with a note — the teacher
 * changes what was asked and sends it again — or confirms it, and its grades
 * become **official**.
 *
 * - **A register is a run and a round**, not a run forever: repeaters redo the
 *   module in the same run (a new attempt, OOC-156) and a student may be moved
 *   in later. Grades posted after a run's register went official open the
 *   next round, with its own state and deadline.
 * - **Only official grades count** for advancing to the next module and for
 *   the certificate (decision of 18/11/2026). A grade "in review" is shown to
 *   the student as such and moves nothing.
 * - **Finishing the class group stays on the posted grade** (OOC-102): the
 *   last grade posted moves it to finished, official or not.
 * - **A correction after official keeps it official**: the supervision's
 *   correction, with its reason and e-mail, as before.
 * - A grade posted before registers existed has none, and reads as official —
 *   that is what it was under the rule of its day ("final as posted").
 */

export const GRADE_REGISTER_STATUSES = ["draft", "in_review", "returned", "official"] as const;
export type GradeRegisterStatus = (typeof GRADE_REGISTER_STATUSES)[number];

export type GradeRegisterStepKind = "submitted" | "returned" | "confirmed";

/** One step of a register, oldest first. */
export interface GradeRegisterStep {
  kind: GradeRegisterStepKind;
  at: Date;
  /** The account's name; null when the account no longer has one to show. */
  byName: string | null;
  /** What coordination asked to correct — only on `returned`. */
  note: string | null;
}

/** How long a return note may be — the database CHECK (0073). */
export const MAX_REGISTER_RETURN_NOTE_LENGTH = 1000;

/** The teacher posts and changes grades while the register is theirs. */
export function teacherMayEdit(status: GradeRegisterStatus): boolean {
  return status === "draft" || status === "returned";
}

/** Lima is UTC−5 all year (no daylight saving). */
const LIMA_OFFSET_HOURS = 5;

/**
 * When the register is due: `hours` (Configuration, 48 today) after the end
 * of the module's last day in Lima. Counted from the end of that day, not its
 * start, because the final exam may be on the last day itself. No end date,
 * no deadline.
 */
export function registerDeadline(moduleEndsOn: string | null, hours: number): Date | null {
  if (moduleEndsOn === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(moduleEndsOn);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const endOfDay = Date.UTC(year, month - 1, day + 1, LIMA_OFFSET_HOURS);
  return new Date(endOfDay + hours * 3_600_000);
}

/**
 * A register as the screens read it: the teacher's portal, the class group's
 * grade block and the list of registers.
 */
export interface GradeRegisterView {
  /** Null while nothing of this round was posted yet — the register exists once a grade does. */
  registerId: string | null;
  classGroupId: string;
  classGroupModuleId: string;
  round: number;
  status: GradeRegisterStatus;
  /** The run's end date now (the open round), or as it stood when the register was sent. */
  moduleEndsOn: string | null;
  deadlineAt: Date | null;
  /** Not sent yet and past the deadline ("Fuera de plazo"). */
  overdue: boolean;
  /** First sent after the deadline that stood then. */
  submittedLate: boolean;
  /** Seats of this round with a grade in it. */
  graded: number;
  /** Seats of this round: the run's confirmed seats whose current attempt is graded here or not at all. */
  total: number;
  /** Coordination's note on the latest return, while the register is returned. */
  returnNote: string | null;
  steps: GradeRegisterStep[];
}

/** Derives the late flags; `now` is handed in so a read is one instant. */
export function lateness(params: {
  status: GradeRegisterStatus;
  deadlineAt: Date | null;
  firstSubmittedAt: Date | null;
  firstSubmittedEndsOn: string | null;
  hours: number;
  now: Date;
}): { overdue: boolean; submittedLate: boolean } {
  const overdue = params.status === "draft" && params.deadlineAt !== null && params.now > params.deadlineAt;
  const then = registerDeadline(params.firstSubmittedEndsOn, params.hours);
  const submittedLate = params.firstSubmittedAt !== null && then !== null && params.firstSubmittedAt > then;
  return { overdue, submittedLate };
}

/** The filters of the list of registers (OOC-170's screen). */
export interface GradeRegisterListFilters {
  academicPeriodId: string | null;
  teacherId: string | null;
  module: number | null;
  status: GradeRegisterStatus | null;
  /** Only the ones out of time. */
  overdueOnly: boolean;
}

/** One row of the list: the register and what it is of. */
export interface GradeRegisterListRow extends GradeRegisterView {
  classGroupCode: string;
  courseName: string;
  academicPeriodId: string;
  academicPeriodName: string;
  module: number | null;
  teacherId: string | null;
  teacherName: string | null;
  slots: unknown;
  classGroupStatus: string;
}

export type RegisterTransitionOutcome =
  | { kind: "done"; registerId: string }
  /** Nothing of the round was posted — there is no register to act on. */
  | { kind: "empty" }
  /** Seats of the round still without a grade. */
  | { kind: "incomplete"; missing: number }
  /** The register is not in a state this step starts from. */
  | { kind: "wrong_status"; status: GradeRegisterStatus }
  /** Somebody moved it at the same moment. */
  | { kind: "concurrent" };

/** A seat of a confirmed register: what its official-grade e-mail needs. */
export interface ConfirmedSeat {
  enrollmentId: string;
  value: GradeValue;
}

export interface IGradeRegisterRepository {
  /** The open round of a run — real, or the one the next grade would open — with its counts and steps. */
  currentOf(classGroupModuleId: string, hours: number, now: Date): Promise<GradeRegisterView>;
  /** Every round of every run of a class group, open ones first, then newest. */
  listForClassGroup(classGroupId: string, hours: number, now: Date): Promise<GradeRegisterView[]>;
  /** The list of registers (one row per round, plus the open round of every run being taught). */
  list(filters: GradeRegisterListFilters, hours: number, now: Date): Promise<GradeRegisterListRow[]>;
  /**
   * Sends the run's open register to review: `draft`/`returned` → `in_review`,
   * only when every seat of the round has a grade in it. One transaction with
   * the step (and the run's end date as it stands) and the audit entry.
   */
  submit(params: {
    classGroupModuleId: string;
    actorId: string;
    audit: (registerId: string) => AuditLogEntry;
  }): Promise<RegisterTransitionOutcome>;
  /** `in_review` → `returned`, with coordination's note. */
  returnToTeacher(params: {
    classGroupModuleId: string;
    note: string;
    actorId: string;
    audit: (registerId: string) => AuditLogEntry;
  }): Promise<RegisterTransitionOutcome>;
  /**
   * The run's open register → `official`, from any open state, when the round
   * is complete. The e-mails of every seat in it go in the same transaction.
   */
  confirm(params: {
    classGroupModuleId: string;
    actorId: string;
    audit: (registerId: string, seats: ConfirmedSeat[]) => AuditLogEntry;
    emails: (registerId: string, seats: ConfirmedSeat[], facts: GradeEmailFacts[]) => EmailNotification[];
  }): Promise<RegisterTransitionOutcome>;
}
