import type { ClassGroup } from "../ClassGroup.js";

/**
 * No delete: a class group is retired (deleted_at), never removed. `findById`
 * answers retired rows too — the caller decides.
 */
export interface IClassGroupRepository {
  /**
   * `count` fresh codes (`classGroupCodeOf`), in order, from a sequence that
   * never hands the same number out twice — not even to two panels saving at
   * once. A number taken by a save that then fails is skipped, not reused.
   */
  nextCodes(count: number): Promise<string[]>;
  create(group: ClassGroup): Promise<ClassGroup>;
  findById(id: string): Promise<ClassGroup | null>;
  /**
   * Never writes `seats_taken` — only the atomic seat UPDATE moves it. Throws
   * CapacityBelowSeatsTakenError when the conditional UPDATE finds no row
   * because the capacity would sit under the seats taken.
   */
  update(group: ClassGroup): Promise<ClassGroup>;
  /** Live class groups of a period, plus how many retired ones were left out. */
  listForCopy(periodId: string): Promise<{ copyable: ClassGroup[]; skippedRetired: number }>;
  /**
   * One transaction: inserts every copy or none. Throws
   * PeriodAlreadyDuplicatedError when the target already holds copies of the source.
   */
  insertCopies(sourcePeriodId: string, targetPeriodId: string, copies: ClassGroup[]): Promise<void>;
}
