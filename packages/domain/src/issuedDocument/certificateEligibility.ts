/**
 * Who the course certificate is for (OOC-33, decisions of 18/11/2026 — to
 * confirm with the owner). The certificate is the enrollment's, and the batch
 * is confirmed on the module group of the course's **last** module: whoever
 * reached it and passed it. The rule:
 *
 * - the last module's grade (the current attempt) is at least the pass mark
 *   (`passing_grade`, OOC-41) — never DA;
 * - every earlier module that has a grade on the platform passed it too (its
 *   latest attempt). An earlier module with no grade does not block: grades
 *   only exist on the platform since 09/11/2026 (OOC-38), and a student who
 *   was mid-course then has none for the modules before;
 * - a course that asks for the certification exam (Inglés Básico,
 *   `certificate_rule = exam_required`) also needs coordination to mark the
 *   exam passed in the batch itself — the exam is not on the platform yet.
 *
 * Attendance is not part of it: there is no attendance data. The first
 * blocking reason wins, in the order coordination can act on.
 *
 * The browser never decides who gets a document (CLAUDE.md §8): this runs in
 * the API, on the batch's preview and again on its confirmation.
 */
export const CERTIFICATE_BLOCK_REASONS = [
  "already_issued",
  "grade_pending",
  "did_not_sit",
  "grade_below_minimum",
  "earlier_module_failed",
  "exam_not_approved",
] as const;
export type CertificateBlockReason = (typeof CERTIFICATE_BLOCK_REASONS)[number];

/** A grade as the rule reads it: a 0–20 score, or DA. */
export type CertificateGrade = { score: number; didNotSit: false } | { score: null; didNotSit: true };

export interface CertificateCandidate {
  enrollmentId: string;
  /** The current attempt's grade in the last module; null while none is posted. */
  lastModuleGrade: CertificateGrade | null;
  /** The latest grade of each earlier module that has one on the platform. */
  earlierModuleGrades: { module: number; grade: CertificateGrade }[];
  /** A certificate already issued for this enrollment. */
  alreadyIssued: boolean;
}

export interface CertificateRuleContext {
  passingGrade: number;
  /** The course asks for the certification exam (Inglés Básico). */
  examRequired: boolean;
  /** Coordination marked the exam passed in this batch. */
  examApproved: boolean;
}

const passes = (grade: CertificateGrade, passingGrade: number) => !grade.didNotSit && grade.score >= passingGrade;

/** Why this enrollment does not get the certificate now, or null when it does. */
export function certificateBlockReason(
  candidate: CertificateCandidate,
  context: CertificateRuleContext,
): CertificateBlockReason | null {
  if (candidate.alreadyIssued) return "already_issued";
  const last = candidate.lastModuleGrade;
  if (last === null) return "grade_pending";
  if (last.didNotSit) return "did_not_sit";
  // Compared as typed: no rounding rule was set (CLAUDE.md §1).
  if (last.score < context.passingGrade) return "grade_below_minimum";
  if (candidate.earlierModuleGrades.some(({ grade }) => !passes(grade, context.passingGrade))) {
    return "earlier_module_failed";
  }
  if (context.examRequired && !context.examApproved) return "exam_not_approved";
  return null;
}

/**
 * Whether a module group closes its course — where a certificate batch is
 * confirmed. The course's last module; a course of a single module also takes
 * the module group nobody numbered (every class group made before OOC-100).
 * A full-course run no longer exists on its own since 0059 (OOC-156).
 */
export function closesTheCourse(run: { module: number | null; fullCourse: boolean }, courseModules: number): boolean {
  if (run.fullCourse) return false;
  if (run.module === null) return courseModules <= 1;
  return run.module === Math.max(1, courseModules);
}
