import { DEFAULT_LOCALE } from "../notification/EmailNotification.js";
import { updatedGradeEmails } from "../notification/gradeEmails.js";
import type { IPlatformSettingsRepository } from "../platform/ports/IPlatformSettingsRepository.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { ConflictError } from "../shared/base/errors/ConflictError.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";
import type { GetOwnClassGroupInput, GetOwnClassGroupUseCase } from "./GetOwnClassGroupUseCase.js";
import {
  isValidScore,
  type GradeEntry,
  type GradeValue,
  type IGradeRepository,
  type RecordedGrade,
  type RecordGradesResult,
} from "./Grade.js";
import { GRADING_OPEN, postGrades } from "./gradePosting.js";
import type { GradeRegisterListRow, GradeRegisterView, IGradeRegisterRepository } from "./gradeRegister.js";
import { registerTransitionError } from "./gradeRegisterErrors.js";
import type { ListOwnClassGroupsInput, ListOwnClassGroupsUseCase } from "./ListOwnClassGroupsUseCase.js";
import type { ITeachingReader } from "./TeachingReader.js";

/**
 * The grades that count in one of the signed-in teacher's class groups — a
 * supervision's correction shows here too (OOC-102). The class group goes
 * through the same check as reading it, so another teacher's grades are the
 * same 404 as their class group.
 */
export class ListOwnClassGroupGradesUseCase extends BaseUseCase<GetOwnClassGroupInput, RecordedGrade[]> {
  constructor(
    private readonly getOwnClassGroup: GetOwnClassGroupUseCase,
    private readonly reader: ITeachingReader,
    private readonly grades: IGradeRepository,
  ) {
    super();
  }

  async run(input: GetOwnClassGroupInput): Promise<RecordedGrade[]> {
    const group = await this.getOwnClassGroup.run(input);
    // The grades live on the class group; the teacher reads the ones of the
    // seats in their own module run (OOC-156).
    const [students, grades] = await Promise.all([
      this.reader.listStudents(group.id),
      this.grades.listForClassGroup(group.classGroupId),
    ]);
    const seats = new Set(students.map((student) => student.enrollmentId));
    return grades.filter((grade) => seats.has(grade.enrollmentId));
  }
}

export interface RecordOwnClassGroupGradesInput extends GetOwnClassGroupInput {
  entries: GradeEntry[];
}

/**
 * The teacher posts grades — one, or a batch from the sheet (OOC-38). Only the
 * teacher **of the class group**, checked here against the session's file,
 * never against an id the client sent (CLAUDE.md §8). What posting does — the
 * seats, the retry, the e-mails, finishing the module — is `postGrades`. The
 * teacher posts while the run's register is theirs (OOC-180).
 */
export class RecordOwnClassGroupGradesUseCase extends BaseUseCase<RecordOwnClassGroupGradesInput, RecordGradesResult> {
  constructor(
    private readonly getOwnClassGroup: GetOwnClassGroupUseCase,
    private readonly reader: ITeachingReader,
    private readonly grades: IGradeRepository,
    private readonly settings: IPlatformSettingsRepository,
  ) {
    super();
  }

  async run(input: RecordOwnClassGroupGradesInput): Promise<RecordGradesResult> {
    const group = await this.getOwnClassGroup.run(input);
    // The seats of the teacher's own module run (OOC-156); the grades go to
    // its class group, where every run's grades live.
    const seatIds = (await this.reader.listStudents(group.id)).map((student) => student.enrollmentId);
    return postGrades(
      { grades: this.grades, settings: this.settings },
      { classGroupId: group.classGroupId, status: group.status, seatIds },
      input.userId,
      input.entries,
      true,
    );
  }
}

export interface EditOwnClassGroupGradeInput extends GetOwnClassGroupInput {
  enrollmentId: string;
  value: GradeValue;
}

/**
 * The teacher changes a grade they posted, while the register is theirs —
 * not sent yet, or returned by coordination (OOC-180; reverses the "a posted
 * grade never changes by the teacher" of 08/10 and 10/11/2026). The posted row
 * never changes: the edit is a row of its own in the grade's history, who and
 * when, like the supervision's correction, and needs no reason. The student,
 * and a minor's guardian, hear the new grade by e-mail. Once the register is
 * in review or official, only the supervision corrects.
 */
export class EditOwnClassGroupGradeUseCase extends BaseUseCase<EditOwnClassGroupGradeInput, { editId: string }> {
  constructor(
    private readonly getOwnClassGroup: GetOwnClassGroupUseCase,
    private readonly reader: ITeachingReader,
    private readonly grades: IGradeRepository,
    private readonly settings: IPlatformSettingsRepository,
  ) {
    super();
  }

  async run(input: EditOwnClassGroupGradeInput): Promise<{ editId: string }> {
    const group = await this.getOwnClassGroup.run(input);

    if (!GRADING_OPEN.has(group.status)) {
      throw new UnableToProcessEntryError({
        reason: "teaching.grading_closed",
        message: "Grades are changed while the class group is running or finished.",
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
      this.grades.emailFacts(group.classGroupId, [input.enrollmentId]),
      this.settings.get(),
    ]);

    const outcome = await this.grades.edit({
      classGroupId: group.classGroupId,
      enrollmentId: input.enrollmentId,
      value: input.value,
      editedBy: input.userId,
      emails: (editId) => (fact ? updatedGradeEmails(fact, editId, input.value, passingGrade, DEFAULT_LOCALE) : []),
      // Which seat, never the grade: the edit row is the record of it.
      audit: (editId) => ({
        actorId: input.userId,
        action: "teaching.grade_edited",
        targetId: group.classGroupId,
        metadata: { classGroupId: group.classGroupId, classGroupModuleId: group.id, enrollmentId: input.enrollmentId, editId },
        at: new Date(),
      }),
    });

    switch (outcome.kind) {
      case "edited":
        return { editId: outcome.editId };
      case "not_graded":
        throw new UnableToProcessEntryError({
          reason: "teaching.grade_not_recorded",
          message: "There is no posted grade to change — post it instead.",
        });
      case "same_value":
        throw new UnableToProcessEntryError({
          reason: "teaching.grade_correction_unchanged",
          message: "The grade already is that value.",
        });
      case "locked":
        throw new UnableToProcessEntryError({
          reason: "teaching.grade_register_locked",
          message: "The grade register is in review or official; it is not the teacher's to change.",
        });
      case "concurrent":
        throw new ConflictError({
          reason: "teaching.grade_corrected_concurrently",
          message: "Somebody changed this grade at the same moment. Reload and try again.",
        });
    }
  }
}

/** The open register of one of the teacher's own runs (OOC-180). */
export class GetOwnGradeRegisterUseCase extends BaseUseCase<GetOwnClassGroupInput, GradeRegisterView> {
  constructor(
    private readonly getOwnClassGroup: GetOwnClassGroupUseCase,
    private readonly registers: IGradeRegisterRepository,
    private readonly settings: IPlatformSettingsRepository,
  ) {
    super();
  }

  async run(input: GetOwnClassGroupInput): Promise<GradeRegisterView> {
    const group = await this.getOwnClassGroup.run(input);
    const { gradeSubmissionHours } = await this.settings.get();
    return this.registers.currentOf(group.id, gradeSubmissionHours, new Date());
  }
}

/**
 * The teacher sends the run's register to review (OOC-180) — only with every
 * seat of the round graded. From then on the grades are coordination's to
 * return or confirm, and the teacher no longer changes them.
 */
export class SubmitOwnGradeRegisterUseCase extends BaseUseCase<GetOwnClassGroupInput, { registerId: string }> {
  constructor(
    private readonly getOwnClassGroup: GetOwnClassGroupUseCase,
    private readonly registers: IGradeRegisterRepository,
  ) {
    super();
  }

  async run(input: GetOwnClassGroupInput): Promise<{ registerId: string }> {
    const group = await this.getOwnClassGroup.run(input);
    if (!GRADING_OPEN.has(group.status)) {
      throw new UnableToProcessEntryError({
        reason: "teaching.grading_closed",
        message: "A register is sent while the class group is running or finished.",
      });
    }
    const outcome = await this.registers.submit({
      classGroupModuleId: group.id,
      actorId: input.userId,
      audit: (registerId) => ({
        actorId: input.userId,
        action: "teaching.grade_register_submitted",
        targetId: group.classGroupId,
        metadata: { classGroupId: group.classGroupId, classGroupModuleId: group.id, registerId },
        at: new Date(),
      }),
    });
    if (outcome.kind !== "done") throw registerTransitionError(outcome);
    return { registerId: outcome.registerId };
  }
}

/**
 * The signed-in teacher's grade registers across their module runs (OOC-170):
 * the portal's list of what they still owe, are waiting on, or had returned.
 * The runs are the teacher's own class groups — the same scope as listing
 * them —, and every row is checked against that set again, so what leaves
 * here is the teacher's whatever the query underneath does. A teacher with no
 * run (or an account linked to no file) gets an empty list, never a read for
 * a null id.
 */
export class ListOwnGradeRegistersUseCase extends BaseUseCase<
  ListOwnClassGroupsInput,
  { rows: GradeRegisterListRow[]; submissionHours: number }
> {
  constructor(
    private readonly listOwnClassGroups: ListOwnClassGroupsUseCase,
    private readonly registers: IGradeRegisterRepository,
    private readonly settings: IPlatformSettingsRepository,
  ) {
    super();
  }

  async run(input: ListOwnClassGroupsInput): Promise<{ rows: GradeRegisterListRow[]; submissionHours: number }> {
    const { gradeSubmissionHours } = await this.settings.get();
    const groups = await this.listOwnClassGroups.run(input);
    const teacherId = groups[0]?.teacherId ?? null;
    if (teacherId === null) return { rows: [], submissionHours: gradeSubmissionHours };
    const own = new Set(groups.map((group) => group.id));
    const rows = await this.registers.list(
      { academicPeriodId: null, teacherId, module: null, status: null, overdueOnly: false },
      gradeSubmissionHours,
      new Date(),
    );
    return {
      rows: rows.filter((row) => row.teacherId === teacherId && own.has(row.classGroupModuleId)),
      submissionHours: gradeSubmissionHours,
    };
  }
}
