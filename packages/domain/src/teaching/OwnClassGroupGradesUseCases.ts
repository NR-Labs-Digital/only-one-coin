import type { ClassGroupStatus } from "../catalog/ClassGroup.js";
import { DEFAULT_LOCALE } from "../notification/EmailNotification.js";
import { gradeEmails } from "../notification/gradeEmails.js";
import type { IPlatformSettingsRepository } from "../platform/ports/IPlatformSettingsRepository.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { ConflictError } from "../shared/base/errors/ConflictError.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";
import type { GetOwnClassGroupInput, GetOwnClassGroupUseCase } from "./GetOwnClassGroupUseCase.js";
import { isValidScore, type GradeEntry, type IGradeRepository, type RecordedGrade, type RecordGradesResult } from "./Grade.js";
import type { ITeachingReader } from "./TeachingReader.js";

/**
 * When grades are posted: once the class group is running, and after its last
 * class — the final exam comes after it (decision 08/10/2026). Enrolling has
 * no exam yet; closed is out of the portal.
 */
const GRADING_OPEN: ReadonlySet<ClassGroupStatus> = new Set(["in_progress", "finished"]);

/**
 * The grades already posted in one of the signed-in teacher's class groups.
 * The class group goes through the same check as reading it, so another
 * teacher's grades are the same 404 as their class group.
 */
export class ListOwnClassGroupGradesUseCase extends BaseUseCase<GetOwnClassGroupInput, RecordedGrade[]> {
  constructor(
    private readonly getOwnClassGroup: GetOwnClassGroupUseCase,
    private readonly grades: IGradeRepository,
  ) {
    super();
  }

  async run(input: GetOwnClassGroupInput): Promise<RecordedGrade[]> {
    const group = await this.getOwnClassGroup.run(input);
    return this.grades.listForClassGroup(group.id);
  }
}

export interface RecordOwnClassGroupGradesInput extends GetOwnClassGroupInput {
  entries: GradeEntry[];
}

/**
 * The teacher posts grades — one, or a batch from the sheet (OOC-38). Only the
 * teacher **of the class group**, checked here against the session's file,
 * never against an id the client sent (CLAUDE.md §8); every seat must be a
 * confirmed one in that class group.
 *
 * A posted grade is final. Posting the same value again is a no-op, so the
 * sheet can resend what it could not confirm over a bad connection without
 * fear; posting a different value on a graded seat refuses the whole batch
 * (409 `teaching.grade_already_recorded`) and writes nothing.
 *
 * Each grade written e-mails the student — and a minor's guardian — in the
 * same transaction (OOC-38, request of 09/11/2026, to confirm with the
 * owner): the grade is final the moment it is posted, so that is when the
 * student hears it. es-PE, like the payment e-mails: the platform does not
 * keep a student's language.
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

    if (!GRADING_OPEN.has(group.status)) {
      throw new UnableToProcessEntryError({
        reason: "teaching.grading_closed",
        message: "Grades are posted once the class group is running.",
      });
    }

    if (input.entries.length === 0) {
      throw new UnableToProcessEntryError({ reason: "teaching.no_grades", message: "Nothing to post." });
    }

    const seats = new Set((await this.reader.listStudents(group.id)).map((student) => student.enrollmentId));
    const seen = new Set<string>();
    for (const entry of input.entries) {
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
      this.grades.emailFacts(
        group.id,
        input.entries.map((entry) => entry.enrollmentId),
      ),
      this.settings.get(),
    ]);
    const factsBySeat = new Map(facts.map((fact) => [fact.enrollmentId, fact]));

    const result = await this.grades.record({
      classGroupId: group.id,
      recordedBy: input.userId,
      entries: input.entries,
      emails: (recorded) =>
        recorded.flatMap((entry) => {
          const fact = factsBySeat.get(entry.enrollmentId);
          return fact ? gradeEmails(fact, group.id, entry.value, passingGrade, DEFAULT_LOCALE) : [];
        }),
      // The seats and how many were DA — never the grades: they are the
      // `grades` rows themselves, and the log only says that they were posted.
      audit: (recorded) => ({
        actorId: input.userId,
        action: "teaching.grades_recorded",
        targetId: group.id,
        metadata: {
          classGroupId: group.id,
          enrollmentIds: recorded.map((entry) => entry.enrollmentId),
          didNotSit: recorded.filter((entry) => entry.value.kind === "did_not_sit").length,
        },
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
}
