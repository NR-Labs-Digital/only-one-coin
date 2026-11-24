import { CatalogClassGroupNotFoundError } from "../catalog/errors.js";
import { DEFAULT_LOCALE } from "../notification/EmailNotification.js";
import { officialGradeEmails } from "../notification/gradeEmails.js";
import type { IPlatformSettingsRepository } from "../platform/ports/IPlatformSettingsRepository.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";
import {
  MAX_REGISTER_RETURN_NOTE_LENGTH,
  type GradeRegisterListFilters,
  type GradeRegisterListRow,
  type GradeRegisterView,
  type IGradeRegisterRepository,
} from "./gradeRegister.js";
import { registerTransitionError } from "./gradeRegisterErrors.js";
import type { ITeachingReader } from "./TeachingReader.js";

/**
 * Coordination's side of the grade register (OOC-180): reading every run's
 * registers, returning one to the teacher with what to correct, and confirming
 * one — its grades become official. Who may do which is the route's role list
 * (`gradeRoles.ts`); the class group is any one.
 */

async function assertRunOf(reader: ITeachingReader, classGroupId: string, classGroupModuleId: string): Promise<void> {
  const run = await reader.findClassGroup(classGroupModuleId);
  if (!run || run.classGroupId !== classGroupId) throw new CatalogClassGroupNotFoundError();
}

/** Every round of every run of a class group. */
export class ListClassGroupGradeRegistersUseCase extends BaseUseCase<{ classGroupId: string }, GradeRegisterView[]> {
  constructor(
    private readonly reader: ITeachingReader,
    private readonly registers: IGradeRegisterRepository,
    private readonly settings: IPlatformSettingsRepository,
  ) {
    super();
  }

  async run(input: { classGroupId: string }): Promise<GradeRegisterView[]> {
    const group = await this.reader.findGradingClassGroup(input.classGroupId);
    if (!group) throw new CatalogClassGroupNotFoundError();
    const { gradeSubmissionHours } = await this.settings.get();
    return this.registers.listForClassGroup(group.id, gradeSubmissionHours, new Date());
  }
}

/** The list of registers pending review and out of time (OOC-180 step 6, OOC-170). */
export class ListGradeRegistersUseCase extends BaseUseCase<
  GradeRegisterListFilters,
  { rows: GradeRegisterListRow[]; submissionHours: number }
> {
  constructor(
    private readonly registers: IGradeRegisterRepository,
    private readonly settings: IPlatformSettingsRepository,
  ) {
    super();
  }

  async run(filters: GradeRegisterListFilters) {
    const { gradeSubmissionHours } = await this.settings.get();
    const rows = await this.registers.list(filters, gradeSubmissionHours, new Date());
    return { rows, submissionHours: gradeSubmissionHours };
  }
}

export interface RegisterStepInput {
  actorId: string;
  classGroupId: string;
  classGroupModuleId: string;
}

/**
 * Coordination returns the register to the teacher with what to correct. The
 * teacher sees the note in the portal, changes the grades — each change
 * e-mails the student — and sends it again.
 */
export class ReturnGradeRegisterUseCase extends BaseUseCase<RegisterStepInput & { note: string }, { registerId: string }> {
  constructor(
    private readonly reader: ITeachingReader,
    private readonly registers: IGradeRegisterRepository,
  ) {
    super();
  }

  async run(input: RegisterStepInput & { note: string }): Promise<{ registerId: string }> {
    await assertRunOf(this.reader, input.classGroupId, input.classGroupModuleId);
    const note = input.note.trim();
    if (note.length === 0 || note.length > MAX_REGISTER_RETURN_NOTE_LENGTH) {
      throw new UnableToProcessEntryError({
        reason: "teaching.grade_register_note_required",
        message: "Returning a register says what to correct, up to 1000 characters.",
      });
    }
    const outcome = await this.registers.returnToTeacher({
      classGroupModuleId: input.classGroupModuleId,
      note,
      actorId: input.actorId,
      // The note stays in the register's steps, never in the log.
      audit: (registerId) => ({
        actorId: input.actorId,
        action: "teaching.grade_register_returned",
        targetId: input.classGroupId,
        metadata: { classGroupId: input.classGroupId, classGroupModuleId: input.classGroupModuleId, registerId },
        at: new Date(),
      }),
    });
    if (outcome.kind !== "done") throw registerTransitionError(outcome);
    return { registerId: outcome.registerId };
  }
}

/**
 * Coordination confirms the register: its grades become official — the ones
 * that let a student advance and count for the certificate (decision of
 * 18/11/2026). Each student of the round, and a minor's guardian, hears the
 * official grade by e-mail in the same transaction.
 */
export class ConfirmGradeRegisterUseCase extends BaseUseCase<RegisterStepInput, { registerId: string }> {
  constructor(
    private readonly reader: ITeachingReader,
    private readonly registers: IGradeRegisterRepository,
    private readonly settings: IPlatformSettingsRepository,
  ) {
    super();
  }

  async run(input: RegisterStepInput): Promise<{ registerId: string }> {
    await assertRunOf(this.reader, input.classGroupId, input.classGroupModuleId);
    const { passingGrade } = await this.settings.get();
    const outcome = await this.registers.confirm({
      classGroupModuleId: input.classGroupModuleId,
      actorId: input.actorId,
      audit: (registerId, seats) => ({
        actorId: input.actorId,
        action: "teaching.grade_register_confirmed",
        targetId: input.classGroupId,
        metadata: {
          classGroupId: input.classGroupId,
          classGroupModuleId: input.classGroupModuleId,
          registerId,
          enrollmentIds: seats.map((seat) => seat.enrollmentId),
        },
        at: new Date(),
      }),
      emails: (registerId, seats, facts) => {
        const bySeat = new Map(facts.map((fact) => [fact.enrollmentId, fact]));
        return seats.flatMap((seat) => {
          const fact = bySeat.get(seat.enrollmentId);
          return fact ? officialGradeEmails(fact, registerId, seat.value, passingGrade, DEFAULT_LOCALE) : [];
        });
      },
    });
    if (outcome.kind !== "done") throw registerTransitionError(outcome);
    return { registerId: outcome.registerId };
  }
}
