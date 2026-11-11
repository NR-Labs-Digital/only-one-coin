import type { AuditLogEntry } from "../identity/ports/IAuditLogRepository.js";
import type { EmailNotification } from "../notification/EmailNotification.js";
import type { GradeEmailFacts } from "../notification/gradeEmails.js";

/**
 * A grade as the sheet posts it (OOC-38, CLAUDE.md §1, decision 08/10/2026):
 * one per student, the final exam's, which is the module's grade — on the
 * 0–20 scale with up to two decimals, compared as typed (no rounding rule was
 * given) — or DA, the final exam not sat, in its place.
 */
export type GradeValue = { kind: "score"; score: number } | { kind: "did_not_sit" };

export interface GradeEntry {
  enrollmentId: string;
  value: GradeValue;
}

/**
 * A seat's grade as it counts today: the posted one, or its last correction
 * (OOC-102). The posted row itself never changes — a correction is a row of
 * its own, and `value` is whichever is the latest.
 */
export interface RecordedGrade {
  enrollmentId: string;
  value: GradeValue;
  /** When the grade was first posted. */
  recordedAt: Date;
  /** When the last correction was made; null = never corrected. */
  correctedAt: Date | null;
}

/** One link of a grade's history, oldest first: the posting, then each correction. */
export interface GradeHistoryEntry {
  value: GradeValue;
  at: Date;
  /** The account's name; null when the account no longer has one to show. */
  byName: string | null;
  /** Why it was corrected; null on the posting itself. */
  reason: string | null;
}

/** A seat's grade with its whole history — what the supervision reads (OOC-102). */
export interface GradeWithHistory extends RecordedGrade {
  history: GradeHistoryEntry[];
}

export const MIN_GRADE = 0;
export const MAX_GRADE = 20;

/** How long a correction's reason may be — the same bound as the database CHECK (0052). */
export const MAX_CORRECTION_REASON_LENGTH = 500;

/** Within 0–20 and at most two decimal places — what the sheet accepts. */
export function isValidScore(score: number): boolean {
  if (!Number.isFinite(score) || score < MIN_GRADE || score > MAX_GRADE) return false;
  return Math.abs(Math.round(score * 100) - score * 100) < 1e-6;
}

export function sameGrade(a: GradeValue, b: GradeValue): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "did_not_sit" || Math.round(a.score * 100) === Math.round((b as { score: number }).score * 100);
}

export interface RecordGradesResult {
  /** Grades written now. */
  recorded: number;
  /** Grades that were already posted with the same value — a retry after a lost connection. */
  alreadyRecorded: number;
  /**
   * The batch left every confirmed seat graded and moved the class group from
   * in progress to finished (OOC-102). False when it was already finished, or
   * seats are still missing a grade.
   */
  finished: boolean;
}

export type CorrectGradeOutcome =
  | { kind: "corrected"; correctionId: string }
  /** The seat has no posted grade to correct. */
  | { kind: "not_graded" }
  /** The grade already is that value — nothing to correct. */
  | { kind: "same_value" }
  /** Somebody corrected the same grade at the same moment; this one was not written. */
  | { kind: "concurrent" };

export interface IGradeRepository {
  /** The grade that counts per graded seat (`current_grades`). */
  listForClassGroup(classGroupId: string): Promise<RecordedGrade[]>;
  /** The same, each with its history and who did each step. */
  listWithHistory(classGroupId: string): Promise<GradeWithHistory[]>;
  /** The people and course behind these seats of the class group, for the grade e-mails. */
  emailFacts(classGroupId: string, enrollmentIds: string[]): Promise<GradeEmailFacts[]>;
  /**
   * Posts the entries in one transaction: an entry whose seat already has the
   * same **posted** grade is skipped (a correction since does not turn a
   * retry into a conflict), and one whose seat has a different posted grade
   * refuses the whole batch — `conflicts` lists those seats and nothing is
   * written. The audit entry and the e-mails of the seats actually written go
   * in the same transaction — a retry that writes nothing e-mails nobody.
   *
   * When something was written and every seat of `seatIds` now has a grade,
   * an in-progress class group moves to finished in the same transaction,
   * with `finishAudit`'s entry.
   */
  record(params: {
    classGroupId: string;
    recordedBy: string;
    entries: GradeEntry[];
    seatIds: string[];
    audit: (recorded: GradeEntry[]) => AuditLogEntry;
    finishAudit: () => AuditLogEntry;
    emails: (recorded: GradeEntry[]) => EmailNotification[];
  }): Promise<RecordGradesResult | { conflicts: string[] }>;
  /**
   * Appends a correction to the seat's posted grade, replacing its latest
   * correction, with the audit entry and the e-mails in the same transaction.
   */
  correct(params: {
    classGroupId: string;
    enrollmentId: string;
    value: GradeValue;
    reason: string;
    correctedBy: string;
    audit: (correctionId: string) => AuditLogEntry;
    emails: (correctionId: string) => EmailNotification[];
  }): Promise<CorrectGradeOutcome>;
}
