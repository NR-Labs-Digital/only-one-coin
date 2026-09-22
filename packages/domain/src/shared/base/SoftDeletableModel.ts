import { z } from "zod";
import { BaseModel, BaseModelPropsSchema } from "./BaseModel.js";

/**
 * An entity that can leave the platform's present without leaving its history
 * — "exclusão é sempre `deleted_at`" (CLAUDE.md §6). The database says the
 * same thing from the other side: migration 0011 refuses a physical DELETE on
 * the tables that carry history or legal proof.
 *
 * Separate from BaseModel on purpose. Not everything can be retired: an audit
 * entry, a Ley 29733 consent, a plan price and a payment are append-only —
 * they record that something happened, and something that happened does not
 * stop having happened. Those entities extend BaseModel and simply have no
 * `softDelete()` to call, so the type refuses what the database would refuse
 * anyway, at the point where it is cheap to notice.
 *
 * Who extends this today: Student, Guardian, Enrollment.
 */
export const SoftDeletableModelPropsSchema = BaseModelPropsSchema.extend({
  /** Absent or null while the record still answers for itself. */
  deletedAt: z.coerce.date().nullable().optional(),
});

export type SoftDeletableModelProps = z.infer<typeof SoftDeletableModelPropsSchema>;

/** The props an entity's create DTO never accepts — the record's own history. */
export const BASE_PROPS_KEYS = {
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const;

export abstract class SoftDeletableModel extends BaseModel {
  /** When the record was retired, or null while it still answers for itself. */
  public deletedAt: Date | null;

  constructor(props: SoftDeletableModelProps) {
    super(props);
    this.deletedAt = props.deletedAt ?? null;
  }

  get isDeleted(): boolean {
    return this.deletedAt !== null;
  }

  /**
   * Retires the record: marks it, keeps everything it knows.
   *
   * Idempotent, and the first marking wins. Retiring something already retired
   * is not an error — a re-run of a job, a second click — and must not move the
   * date, because when it left is a fact about the record, not about the call.
   */
  softDelete(at: Date = new Date()): void {
    if (this.deletedAt !== null) {
      return;
    }

    this.deletedAt = at;
    this.touch(at);
  }
}
