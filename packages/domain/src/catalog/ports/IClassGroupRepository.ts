import type { ClassGroup } from "../ClassGroup.js";
import type { ClassGroupModule } from "../ClassGroupModule.js";

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
  /** The class group and its module runs, in one transaction. */
  create(group: ClassGroup): Promise<ClassGroup>;
  /** With its module runs (OOC-156). */
  findById(id: string): Promise<ClassGroup | null>;
  /**
   * Never writes `seats_taken` — only the atomic seat UPDATE moves it. Throws
   * CapacityBelowSeatsTakenError when the conditional UPDATE finds no row
   * because the capacity would sit under the seats taken.
   */
  update(group: ClassGroup): Promise<ClassGroup>;
  /**
   * A new module run (OOC-156). Throws ClassGroupModuleTakenError when the
   * class group got a run of that module meanwhile (0058's unique indexes).
   */
  insertModule(run: ClassGroupModule): Promise<ClassGroupModule>;
  /** Same refusal as `insertModule` when the new module is taken meanwhile. */
  updateModule(run: ClassGroupModule): Promise<ClassGroupModule>;
  /**
   * Marks the run retired only while no live seat is in it — checked by the
   * write itself, a seat can land in it meanwhile. Throws
   * ClassGroupModuleHasStudentsError otherwise.
   */
  retireModule(run: ClassGroupModule): Promise<void>;
  /** Live class groups of a period, plus how many retired ones were left out. */
  listForCopy(periodId: string): Promise<{ copyable: ClassGroup[]; skippedRetired: number }>;
  /**
   * One transaction: inserts every copy or none. Throws
   * PeriodAlreadyDuplicatedError when the target already holds copies of the source.
   */
  insertCopies(sourcePeriodId: string, targetPeriodId: string, copies: ClassGroup[]): Promise<void>;
}
