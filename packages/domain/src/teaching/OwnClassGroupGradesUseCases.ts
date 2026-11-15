import type { IPlatformSettingsRepository } from "../platform/ports/IPlatformSettingsRepository.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { GetOwnClassGroupInput, GetOwnClassGroupUseCase } from "./GetOwnClassGroupUseCase.js";
import type { GradeEntry, IGradeRepository, RecordedGrade, RecordGradesResult } from "./Grade.js";
import { postGrades } from "./gradePosting.js";
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
 * teacher never corrects: a posted grade changes only by the supervision's
 * correction (OOC-102).
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
    );
  }
}
