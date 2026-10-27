import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import { ClassGroup } from "./ClassGroup.js";
import { DuplicateSamePeriodError, PeriodNotFoundError } from "./errors.js";
import type { IAcademicPeriodRepository } from "./ports/IAcademicPeriodRepository.js";
import type { IClassGroupRepository } from "./ports/IClassGroupRepository.js";

export interface DuplicateClassGroupsInput {
  actorId: string;
  sourcePeriodId: string;
  targetPeriodId: string;
}

/**
 * Copies a period's class groups into another one, as drafts with no dates and
 * no seats taken (OOC-35 acceptance criterion). Retired class groups — and
 * class groups of retired courses — stay behind. Enrollments, waitlists and
 * seat holds never come along: they belong to people of the old period.
 *
 * Runs once per (source, target): a second run answers 409 instead of 80
 * class groups. A retired source is accepted on purpose — copying the cycle
 * that just left the catalog is the normal case.
 */
export class DuplicateClassGroupsUseCase extends BaseUseCase<
  DuplicateClassGroupsInput,
  { copied: number; skippedRetired: number }
> {
  constructor(
    private readonly periods: IAcademicPeriodRepository,
    private readonly classGroups: IClassGroupRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: DuplicateClassGroupsInput): Promise<{ copied: number; skippedRetired: number }> {
    if (input.sourcePeriodId === input.targetPeriodId) throw new DuplicateSamePeriodError();

    const source = await this.periods.findById(input.sourcePeriodId);
    if (!source) throw new PeriodNotFoundError();
    const target = await this.periods.findById(input.targetPeriodId);
    if (!target || target.isDeleted) throw new PeriodNotFoundError();

    const { copyable, skippedRetired } = await this.classGroups.listForCopy(source.id);
    const codes = await this.classGroups.nextCodes(copyable.length);
    const copies = copyable.map((group, index) => ClassGroup.copyInto(group, target.id, codes[index]!));

    await this.classGroups.insertCopies(source.id, target.id, copies);

    const at = new Date();
    await this.auditLog.append({
      actorId: input.actorId,
      action: "catalog.academic_period.duplicated",
      targetId: target.id,
      metadata: { sourcePeriodId: source.id, copied: copies.length, skippedRetired },
      at,
    });

    return { copied: copies.length, skippedRetired };
  }
}
