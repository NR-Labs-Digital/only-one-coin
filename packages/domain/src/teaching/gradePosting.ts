import type { ClassGroupStatus } from "../catalog/ClassGroup.js";
import { DEFAULT_LOCALE } from "../notification/EmailNotification.js";
import { gradeEmails } from "../notification/gradeEmails.js";
import type { IPlatformSettingsRepository } from "../platform/ports/IPlatformSettingsRepository.js";
import { ConflictError } from "../shared/base/errors/ConflictError.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";
import { isValidScore, type GradeEntry, type IGradeRepository, type RecordGradesResult } from "./Grade.js";
import type { ITeachingReader, TeachingClassGroup } from "./TeachingReader.js";

/**
 * When grades are posted: once the class group is running, and after its last
 * class — the final exam comes after it (decision 08/10/2026). Enrolling has
 * no exam yet; closed is out of the teacher's portal.
 */
export const GRADING_OPEN: ReadonlySet<ClassGroupStatus> = new Set(["in_progress", "finished"]);

export interface GradePostingDeps {
  reader: ITeachingReader;
  grades: IGradeRepository;
  settings: IPlatformSettingsRepository;
}

/**
 * Posting final grades, whoever posts them — the class group's teacher from
 * the portal (OOC-38) or the academic supervision from the backoffice
 * (OOC-102). Who may post in this class group is the caller's check; what a
 * grade is, which seats take one, and what a retry does is this function's.
 *
 * A posted grade is final as posted: the same value again is a no-op, a
 * different value on a graded seat refuses the whole batch (409
 * `teaching.grade_already_recorded`) and writes nothing — changing it is a
 * correction (`CorrectClassGroupGradeUseCase`), never a second posting.
 *
 * Each grade written e-mails the student — and a minor's guardian — in the
 * same transaction (OOC-38, request of 09/11/2026, to confirm with the
 * owner). es-PE, like the payment e-mails: the platform does not keep a
 * student's language.
 *
 * Sending the grades finishes the module (OOC-102, decision of 10/11/2026):
 * the batch that leaves every confirmed seat graded moves an in-progress
 * class group to finished, in the same transaction, with its own audit entry.
 * A finished class group stays in the teacher's portal until coordination
 * closes it.
 */
export async function postGrades(
  deps: GradePostingDeps,
  group: TeachingClassGroup,
  actorId: string,
  entries: GradeEntry[],
): Promise<RecordGradesResult> {
  if (!GRADING_OPEN.has(group.status)) {
    throw new UnableToProcessEntryError({
      reason: "teaching.grading_closed",
      message: "Grades are posted once the class group is running.",
    });
  }

  if (entries.length === 0) {
    throw new UnableToProcessEntryError({ reason: "teaching.no_grades", message: "Nothing to post." });
  }

  const seatIds = (await deps.reader.listStudents(group.id)).map((student) => student.enrollmentId);
  const seats = new Set(seatIds);
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!seats.has(entry.enrollmentId)) {
      throw new UnableToProcessEntryError({
        reason: "teaching.grade_unknown_enrollment",
        message: "Not a confirmed seat in this class group.",
      });
    }
    if (seen.has(entry.enrollmentId)) {
      throw new UnableToProcessEntryError({
        reason: "teaching.grade_duplicate_enrollment",
        message: "The same student twice in one batch.",
      });
    }
    seen.add(entry.enrollmentId);
    if (entry.value.kind === "score" && !isValidScore(entry.value.score)) {
      throw new UnableToProcessEntryError({
        reason: "teaching.grade_out_of_range",
        message: "A grade is 0 to 20, with at most two decimals.",
      });
    }
  }

  const [facts, { passingGrade }] = await Promise.all([
    deps.grades.emailFacts(
      group.id,
      entries.map((entry) => entry.enrollmentId),
    ),
    deps.settings.get(),
  ]);
  const factsBySeat = new Map(facts.map((fact) => [fact.enrollmentId, fact]));

  const result = await deps.grades.record({
    classGroupId: group.id,
    recordedBy: actorId,
    entries,
    seatIds,
    emails: (recorded) =>
      recorded.flatMap((entry) => {
        const fact = factsBySeat.get(entry.enrollmentId);
        return fact ? gradeEmails(fact, group.id, entry.value, passingGrade, DEFAULT_LOCALE) : [];
      }),
    // The seats and how many were DA — never the grades: they are the
    // `grades` rows themselves, and the log only says that they were posted.
    audit: (recorded) => ({
      actorId,
      action: "teaching.grades_recorded",
      targetId: group.id,
      metadata: {
        classGroupId: group.id,
        enrollmentIds: recorded.map((entry) => entry.enrollmentId),
        didNotSit: recorded.filter((entry) => entry.value.kind === "did_not_sit").length,
      },
      at: new Date(),
    }),
    // The same entry a person advancing the status writes, with why it moved.
    finishAudit: () => ({
      actorId,
      action: "catalog.class_group.status_changed",
      targetId: group.id,
      metadata: { from: "in_progress", to: "finished", cause: "grades_completed" },
      at: new Date(),
    }),
  });

  if ("conflicts" in result) {
    throw new ConflictError({
      reason: "teaching.grade_already_recorded",
      message: "A grade was already posted for one of these students.",
    });
  }
  return result;
}
