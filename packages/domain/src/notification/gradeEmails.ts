import type { GradeValue } from "../teaching/Grade.js";
import type { EmailNotification, Locale } from "./EmailNotification.js";
import { enrollmentRecipients, type EnrollmentEmailFacts } from "./enrollmentEmails.js";

/** What a grade e-mail needs: the seat's people and course. */
export interface GradeEmailFacts {
  enrollmentId: string;
  /** The run and attempt the seat is in now (OOC-156) — what makes each grade's e-mail its own. */
  classGroupModuleId: string;
  attempt: number;
  student: EnrollmentEmailFacts["student"];
  guardian: EnrollmentEmailFacts["guardian"];
  courseName: string;
}

/**
 * "Your final grade is in" (OOC-38) — sent when the teacher posts it; it says
 * the grade is in review until coordination confirms it (OOC-180). Same recipients as the enrollment e-mails: the
 * student, and a minor's guardian (decision of 27/09/2026).
 *
 * It says the grade and the pass mark, and promises nothing about the
 * certificate: Inglés Básico also needs the certification exam (CLAUDE.md §1),
 * and issuing is coordination's batch (OOC-33).
 *
 * Keyed by module run, attempt and seat (OOC-156): the next module's grade,
 * and a repeated module's, are e-mails of their own; a retry of the same one
 * is not.
 */
export function gradeEmails(
  facts: GradeEmailFacts,
  value: GradeValue,
  passingGrade: number,
  locale: Locale,
): EmailNotification[] {
  const studentName = `${facts.student.firstName} ${facts.student.lastName}`;

  return enrollmentRecipients(facts).map((recipient): EmailNotification => {
    const base = { to: recipient.to, locale };
    if (value.kind === "did_not_sit") {
      return {
        ...base,
        templateKey: "grade_did_not_sit",
        vars: { recipientName: recipient.name, studentName, courseName: facts.courseName },
        dedupeKey: `grade_did_not_sit:${facts.classGroupModuleId}:${facts.attempt}:${facts.enrollmentId}:${recipient.kind}`,
      };
    }
    return {
      ...base,
      templateKey: "grade_posted",
      vars: {
        recipientName: recipient.name,
        studentName,
        courseName: facts.courseName,
        grade: value.score,
        passingGrade,
      },
      dedupeKey: `grade_posted:${facts.classGroupModuleId}:${facts.attempt}:${facts.enrollmentId}:${recipient.kind}`,
    };
  });
}

/**
 * "Your final grade was corrected" (OOC-102) — sent when the academic
 * supervision corrects a posted grade: the new grade and the pass mark, or DA.
 * Same recipients as the grade e-mail. Keyed by the correction, so a second
 * correction of the same grade is a second e-mail, and a retry of the same
 * one is not.
 */
export function correctedGradeEmails(
  facts: GradeEmailFacts,
  correctionId: string,
  value: GradeValue,
  passingGrade: number,
  locale: Locale,
): EmailNotification[] {
  const studentName = `${facts.student.firstName} ${facts.student.lastName}`;

  return enrollmentRecipients(facts).map((recipient): EmailNotification => {
    const base = { to: recipient.to, locale };
    if (value.kind === "did_not_sit") {
      return {
        ...base,
        templateKey: "grade_corrected_did_not_sit",
        vars: { recipientName: recipient.name, studentName, courseName: facts.courseName },
        dedupeKey: `grade_corrected_did_not_sit:${correctionId}:${recipient.kind}`,
      };
    }
    return {
      ...base,
      templateKey: "grade_corrected",
      vars: {
        recipientName: recipient.name,
        studentName,
        courseName: facts.courseName,
        grade: value.score,
        passingGrade,
      },
      dedupeKey: `grade_corrected:${correctionId}:${recipient.kind}`,
    };
  });
}

/** The e-mails of one grade, by template pair: a score, or DA. */
function pairEmails(
  facts: GradeEmailFacts,
  value: GradeValue,
  passingGrade: number,
  locale: Locale,
  templates: { score: "grade_updated" | "grade_official"; didNotSit: "grade_updated_did_not_sit" | "grade_official_did_not_sit" },
  key: string,
): EmailNotification[] {
  const studentName = `${facts.student.firstName} ${facts.student.lastName}`;
  return enrollmentRecipients(facts).map((recipient): EmailNotification => {
    const base = { to: recipient.to, locale };
    if (value.kind === "did_not_sit") {
      return {
        ...base,
        templateKey: templates.didNotSit,
        vars: { recipientName: recipient.name, studentName, courseName: facts.courseName },
        dedupeKey: `${templates.didNotSit}:${key}:${recipient.kind}`,
      };
    }
    return {
      ...base,
      templateKey: templates.score,
      vars: { recipientName: recipient.name, studentName, courseName: facts.courseName, grade: value.score, passingGrade },
      dedupeKey: `${templates.score}:${key}:${recipient.kind}`,
    };
  });
}

/**
 * "Your grade was updated" (OOC-180) — the teacher changed a grade while the
 * register was still theirs. Still in review. Keyed by the edit.
 */
export function updatedGradeEmails(
  facts: GradeEmailFacts,
  editId: string,
  value: GradeValue,
  passingGrade: number,
  locale: Locale,
): EmailNotification[] {
  return pairEmails(
    facts,
    value,
    passingGrade,
    locale,
    { score: "grade_updated", didNotSit: "grade_updated_did_not_sit" },
    editId,
  );
}

/**
 * "Your grade is official" (OOC-180, decision of 18/11/2026) — coordination
 * confirmed the register. Keyed by register and seat: a retry sends nothing
 * twice, and the next round's register is an e-mail of its own.
 */
export function officialGradeEmails(
  facts: GradeEmailFacts,
  registerId: string,
  value: GradeValue,
  passingGrade: number,
  locale: Locale,
): EmailNotification[] {
  return pairEmails(
    facts,
    value,
    passingGrade,
    locale,
    { score: "grade_official", didNotSit: "grade_official_did_not_sit" },
    `${registerId}:${facts.enrollmentId}`,
  );
}
