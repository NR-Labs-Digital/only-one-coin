/**
 * What every entity carries regardless of what it models: who it is, and when
 * it came into being and last changed. The timestamps mirror the `created_at`
 * / `updated_at` pair every table has (packages/db/src/base-schema.ts) so an
 * entity read back from the database is not poorer than its row.
 *
 * Being retired (`deleted_at`) is deliberately NOT here — see
 * SoftDeletableModel.
 */
import { z } from "zod";

/**
 * The fields every entity's props schema starts from. Entities extend it
 * (`BaseModelPropsSchema.extend({ ... })`) instead of retyping `id` and the
 * timestamps, and drop them again for their create DTO — nothing outside the
 * database decides when a record was born.
 */
export const BaseModelPropsSchema = z.object({
  id: z.string().uuid(),
  /** Absent when the entity is being created — this is that moment. */
  createdAt: z.coerce.date().optional(),
  /** Absent when the entity is being created — same as `createdAt` then. */
  updatedAt: z.coerce.date().optional(),
});

export type BaseModelProps = z.infer<typeof BaseModelPropsSchema>;

export abstract class BaseModel {
  public readonly id: string;
  public readonly createdAt: Date;
  public updatedAt: Date;

  constructor(props: BaseModelProps) {
    this.id = props.id;
    this.createdAt = props.createdAt ?? new Date();
    // A record that has never changed was last changed when it was born —
    // never null, so nothing downstream has to decide what a missing
    // "last changed" means.
    this.updatedAt = props.updatedAt ?? this.createdAt;
  }

  /** Marks the entity as changed now. Call from whatever mutates it. */
  protected touch(at: Date = new Date()): void {
    this.updatedAt = at;
  }
}
