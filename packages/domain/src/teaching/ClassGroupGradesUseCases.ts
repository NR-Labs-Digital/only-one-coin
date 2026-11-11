import type { ClassGroupStatus } from "../catalog/ClassGroup.js";
import { CatalogClassGroupNotFoundError } from "../catalog/errors.js";
import { DEFAULT_LOCALE } from "../notification/EmailNotification.js";
import { correctedGradeEmails } from "../notification/gradeEmails.js";
import type { IPlatformSettingsRepository } from "../platform/ports/IPlatformSettingsRepository.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { ConflictError } from "../shared/base/errors/ConflictError.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";
import {
  isValidScore,
  MAX_CORRECTION_REASON_LENGTH,
  type GradeEntry,
  type GradeValue,
  type GradeWithHistory,
  type IGradeRepository,
  type RecordGradesResult,
} from "./Grade.js";
import { postGrades } from "./gradePosting.js";
import type { ITeachingReader, TeachingClassGroup, TeachingStudent } from "./TeachingReader.js";

/**
 * The academic supervision's side of the grades (OOC-102, decision of
 * 10/11/2026): reading every class group's grades with their history,
 * posting the ones still missing, and correcting a posted one with a reason.
 * Who may do which is the route's role list (`apps/api`, `gradeRoles.ts`);
 * the class group is any one — the supervision is not scoped to a teacher.
 */

/** A correction is made while the class group runs, after it finishes, and after coordination closes it. */
const CORRECTION_OPEN: ReadonlySet<ClassGroupStatus> = new Set(["in_progress", "finished", "closed"]);

async function classGroupOf(reader: ITeachingReader, classGroupId: string): Promise<TeachingClassGroup> {
  const group = await reader.findClassGroup(classGroupId);
  if (!group) throw new CatalogClassGroupNotFoundError();
  return group;
}

export interface ClassGroupGradeSheet {
  status: ClassGroupStatus;
  /** Every confirmed seat, in surname order, with its grade — null while none was posted. */
  seats: Array<TeachingStudent & { grade: GradeWithHistory | null }>;
}

/** The sheet as the supervision reads it: every confirmed seat, graded or not. */
export class ListClassGroupGradesUseCase extends BaseUseCase<{ classGroupId: string }, ClassGroupGradeSheet> {
  constructor(
    private readonly reader: ITeachingReader,
    private readonly grades: IGradeRepository,
  ) {
    super();
  }

  async run(input: { classGroupId: string }): Promise<ClassGroupGradeSheet> {
    const group = await classGroupOf(this.reader, input.classGroupId);
    const [students, grades] = await Promise.all([
      this.reader.listStudents(group.id),
      this.grades.listWithHistory(group.id),
    ]);
    const bySeat = new Map(grades.map((grade) => [grade.enrollmentId, grade]));
    return {
      status: group.status,
      seats: students.map((student) => ({ ...student, grade: bySeat.get(student.enrollmentId) ?? null })),
    };
  }
}

export interface RecordClassGroupGradesInput {
  actorId: string;
  classGroupId: string;
  entries: GradeEntry[];
}

/** The supervision posts the grades still missing — the same rules as the teacher's sheet. */
export class RecordClassGroupGradesUseCase extends BaseUseCase<RecordClassGroupGradesInput, RecordGradesResult> {
  constructor(
    private readonly reader: ITeachingReader,
    private readonly grades: IGradeRepository,
    private readonly settings: IPlatformSettingsRepository,
  ) {
    super();
  }

  async run(input: RecordClassGroupGradesInput): Promise<RecordGradesResult> {
    const group = await classGroupOf(this.reader, input.classGroupId);
    return postGrades(
      { reader: this.reader, grades: this.grades, settings: this.settings },
      group,
      input.actorId,
      input.entries,
    );
  }
}

export interface CorrectClassGroupGradeInput {
  actorId: string;
  classGroupId: string;
  enrollmentId: string;
  value: GradeValue;
  reason: string;
}

/**
 * Corrects a posted grade (OOC-102). The posted row never changes: the
 * correction is a row of its own that replaces the previous one, with the
 * reason, who and when — the history stays whole. The student, and a minor's
 * guardian, hear the new grade by e-mail in the same transaction. The audit
 * entry says which seat was corrected, never the grades nor the reason: those
 * live in the correction itself.
 */
export class CorrectClassGroupGradeUseCase extends BaseUseCase<CorrectClassGroupGradeInput, { correctionId: string }> {
  constructor(
    private readonly reader: ITeachingReader,
    private readonly grades: IGradeRepository,
    private readonly settings: IPlatformSettingsRepository,
  ) {
    super();
  }

  async run(input: CorrectClassGroupGradeInput): Promise<{ correctionId: string }> {
    const group = await classGroupOf(this.reader, input.classGroupId);

    if (!CORRECTION_OPEN.has(group.status)) {
      throw new UnableToProcessEntryError({
        reason: "teaching.grading_closed",
        message: "Grades are corrected once the class group is running.",
      });
    }

    const reason = input.reason.trim();
    if (reason.length === 0 || reason.length > MAX_CORRECTION_REASON_LENGTH) {
      throw new UnableToProcessEntryError({
        reason: "teaching.grade_correction_reason_required",
        message: "A correction needs a reason, up to 500 characters.",
      });
    }

    if (input.value.kind === "score" && !isValidScore(input.value.score)) {
      throw new UnableToProcessEntryError({
        reason: "teaching.grade_out_of_range",
        message: "A grade is 0 to 20, with at most two decimals.",
      });
    }

    const seats = new Set((await this.reader.listStudents(group.id)).map((student) => student.enrollmentId));
    if (!seats.has(input.enrollmentId)) {
      throw new UnableToProcessEntryError({
        reason: "teaching.grade_unknown_enrollment",
        message: "Not a confirmed seat in this class group.",
      });
    }

    const [[fact], { passingGrade }] = await Promise.all([
      this.grades.emailFacts(group.id, [input.enrollmentId]),
      this.settings.get(),
    ]);

    const outcome = await this.grades.correct({
      classGroupId: group.id,
      enrollmentId: input.enrollmentId,
      value: input.value,
      reason,
      correctedBy: input.actorId,
      emails: (correctionId) =>
        fact ? correctedGradeEmails(fact, correctionId, input.value, passingGrade, DEFAULT_LOCALE) : [],
      audit: (correctionId) => ({
        actorId: input.actorId,
        action: "teaching.grade_corrected",
        targetId: group.id,
        metadata: { classGroupId: group.id, enrollmentId: input.enrollmentId, correctionId },
        at: new Date(),
      }),
    });

    switch (outcome.kind) {
      case "corrected":
        return { correctionId: outcome.correctionId };
      case "not_graded":
        throw new UnableToProcessEntryError({
          reason: "teaching.grade_not_recorded",
          message: "There is no posted grade to correct — post it instead.",
        });
      case "same_value":
        throw new UnableToProcessEntryError({
          reason: "teaching.grade_correction_unchanged",
          message: "The grade already is that value.",
        });
      case "concurrent":
        throw new ConflictError({
          reason: "teaching.grade_corrected_concurrently",
          message: "Somebody corrected this grade at the same moment. Reload and try again.",
        });
    }
  }
}
