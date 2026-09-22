import type { BaseModel } from "./BaseModel.js";
import type { SoftDeletableModel } from "./SoftDeletableModel.js";

/**
 * The CRUD shape infrastructure implements — minus the D.
 *
 * There is no `delete(id)` here and there is not going to be one: physical
 * delete does not exist on the tables that carry history (CLAUDE.md §6), and
 * migration 0011 makes Postgres refuse it. A method the database answers with
 * an exception is not a contract, it is a trap for whoever implements the
 * interface next.
 */
export interface IBaseRepository<T extends BaseModel> {
  create(item: T): Promise<T>;
  findById(id: string): Promise<T | null>;
  paginate(page: number, limit: number): Promise<T[]>;
  update(id: string, item: Partial<T>): Promise<T | null>;
}

/**
 * Adds the only kind of removal there is, for the entities that can be retired
 * (SoftDeletableModel). Reads on a repository of this kind are expected to
 * leave retired records out unless the caller asks otherwise — a retired
 * record does not answer for its subject any more.
 */
export interface ISoftDeletableRepository<T extends SoftDeletableModel> extends IBaseRepository<T> {
  softDelete(id: string): Promise<boolean>;
}
