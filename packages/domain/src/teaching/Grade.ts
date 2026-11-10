import type { AuditLogEntry } from "../identity/ports/IAuditLogRepository.js";

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

/** A grade already posted — final, never edited. */
export interface RecordedGrade {
  enrollmentId: string;
  value: GradeValue;
  recordedAt: Date;
}

export const MIN_GRADE = 0;
export const MAX_GRADE = 20;

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
}

export interface IGradeRepository {
  listForClassGroup(classGroupId: string): Promise<RecordedGrade[]>;
  /**
   * Posts the entries in one transaction: an entry whose seat already has the
   * same grade is skipped, and one whose seat has a different grade refuses
   * the whole batch — `conflicts` lists those seats and nothing is written.
   * The audit entry is written in the same transaction, only when something
   * was recorded.
   */
  record(params: {
    classGroupId: string;
    recordedBy: string;
    entries: GradeEntry[];
    audit: (recorded: GradeEntry[]) => AuditLogEntry;
  }): Promise<RecordGradesResult | { conflicts: string[] }>;
}
