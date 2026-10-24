// TODO: switch to native crypto.randomUUIDv7() once engines.node requires >=26 (LTS ~out/2026)
import { v7 as uuid } from "uuid";
import { z } from "zod";
import { BaseModel, BaseModelPropsSchema } from "../shared/base/BaseModel.js";
import { InvalidFieldsError } from "../shared/base/errors/InvalidFieldsError.js";
import { toFieldErrors } from "../student/fields.js";

/**
 * `YYYY-MM-DD`, a calendar day — stored as midnight UTC, like a birth date.
 * The round-trip check refuses days that do not exist: `Date` rolls
 * `2026-02-30` over to March 2 instead of failing.
 */
const CalendarDayField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "invalid")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "invalid")
  .transform((value) => new Date(`${value}T00:00:00Z`));

/** The period a contract covers, as the panel sends it. */
export const TeacherContractPeriodSchema = z
  .object({
    startsOn: CalendarDayField,
    endsOn: CalendarDayField,
  })
  .superRefine((value, ctx) => {
    if (value.startsOn.getTime() > value.endsOn.getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endsOn"], message: "invalid" });
    }
  });

export type TeacherContractPeriodDTO = z.input<typeof TeacherContractPeriodSchema>;

/**
 * The PDF of a contract filed before OOC-124, when the signed copy was
 * uploaded (OOC-81). Rows recorded since then have none.
 */
export interface TeacherContractFile {
  objectKey: string;
  fileName: string;
  fileSizeBytes: number;
}

export const TeacherContractPropsSchema = BaseModelPropsSchema.extend({
  teacherId: z.string().uuid(),
  file: z
    .object({
      objectKey: z.string().min(1),
      fileName: z.string().min(1),
      fileSizeBytes: z.number().int().positive(),
    })
    .nullable(),
  /** The published template version the contract was generated from. */
  templateVersionId: z.string().uuid().nullable(),
  startsOn: z.coerce.date(),
  endsOn: z.coerce.date(),
  /** Better Auth "user".id of whoever recorded it. */
  recordedBy: z.string().min(1),
});

export type TeacherContractProps = z.infer<typeof TeacherContractPropsSchema>;

/**
 * A teacher's contract: the period it covers, which is what the roster's
 * alert watches (CLAUDE.md §1). Since OOC-124 it is recorded when the contract
 * is generated, with the template version the text came from, so the same
 * text prints again; the signed copy is kept outside the platform (decision
 * of 23/10/2026). Rows filed under OOC-81 carry the uploaded PDF instead.
 *
 * Append-only, like the table (0025): correcting one is recording a new one,
 * and the newest is the one in force. No `update`, no `softDelete`.
 */
export class TeacherContract extends BaseModel {
  public readonly teacherId: string;
  public readonly file: TeacherContractFile | null;
  public readonly templateVersionId: string | null;
  public readonly startsOn: Date;
  public readonly endsOn: Date;
  public readonly recordedBy: string;

  constructor(props: TeacherContractProps) {
    super(props);
    this.teacherId = props.teacherId;
    this.file = props.file;
    this.templateVersionId = props.templateVersionId;
    this.startsOn = props.startsOn;
    this.endsOn = props.endsOn;
    this.recordedBy = props.recordedBy;
  }

  /**
   * The contract generated from `templateVersionId` for this period. Throws
   * `InvalidFieldsError` (paths under `contract.`) when the period breaks a rule.
   */
  static record(params: {
    teacherId: string;
    templateVersionId: string;
    recordedBy: string;
    period: TeacherContractPeriodDTO;
  }): TeacherContract {
    const parsed = TeacherContractPeriodSchema.safeParse(params.period);
    if (!parsed.success) throw new InvalidFieldsError(toFieldErrors(parsed.error.issues, "contract"));

    return new TeacherContract({
      id: uuid(),
      teacherId: params.teacherId,
      file: null,
      templateVersionId: params.templateVersionId,
      startsOn: parsed.data.startsOn,
      endsOn: parsed.data.endsOn,
      recordedBy: params.recordedBy,
    });
  }
}
