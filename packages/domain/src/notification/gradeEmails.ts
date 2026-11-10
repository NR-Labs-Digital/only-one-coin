import type { GradeValue } from "../teaching/Grade.js";
import type { EmailNotification, Locale } from "./EmailNotification.js";
import { enrollmentRecipients, type EnrollmentEmailFacts } from "./enrollmentEmails.js";

/** What a grade e-mail needs: the seat's people and course. */
export interface GradeEmailFacts {
  enrollmentId: string;
  student: EnrollmentEmailFacts["student"];
  guardian: EnrollmentEmailFacts["guardian"];
  courseName: string;
}

/**
 * "Your final grade is in" (OOC-38) — sent when the teacher posts it, which
 * is when it becomes final. Same recipients as the enrollment e-mails: the
 * student, and a minor's guardian (decision of 27/09/2026).
 *
 * It says the grade and the pass mark, and promises nothing about the
 * certificate: Inglés Básico also needs the certification exam (CLAUDE.md §1),
 * and issuing is coordination's batch (OOC-33).
 *
 * Keyed by class group and seat: an enrollment that moves on to the next
 * module gets that module's grade e-mail too.
 */
export function gradeEmails(
  facts: GradeEmailFacts,
  classGroupId: string,
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
        dedupeKey: `grade_did_not_sit:${classGroupId}:${facts.enrollmentId}:${recipient.kind}`,
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
      dedupeKey: `grade_posted:${classGroupId}:${facts.enrollmentId}:${recipient.kind}`,
    };
  });
}
