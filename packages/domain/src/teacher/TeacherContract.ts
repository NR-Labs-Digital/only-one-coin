import { z } from "zod";
import { BaseModel, BaseModelPropsSchema } from "../shared/base/BaseModel.js";
import { InvalidFieldsError } from "../shared/base/errors/InvalidFieldsError.js";
import { toFieldErrors } from "../student/fields.js";

/**
 * A signed contract is filed as a PDF — the scan of the paper both sides
 * signed. One type keeps the check honest: the bytes are sniffed for `%PDF-`
 * before a row is written, and there is no image to re-encode.
 */
export const TEACHER_CONTRACT_CONTENT_TYPE = "application/pdf";

/** The bucket's own POST policy refuses anything larger (`content-length-range`). */
export const TEACHER_CONTRACT_MAX_BYTES = 10 * 1024 * 1024;

/** Every PDF opens with these five bytes. */
export const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;

const FILE_NAME_MAX = 200;

/**
 * Where an upload lands, built on the server from the teacher in the URL and
 * an id the server minted — never a key or a name the client chose (CLAUDE.md
 * §8). Filing rebuilds the same key from the same two ids, so a client cannot
 * point a filing at an object under another teacher.
 */
export function teacherContractObjectKey(teacherId: string, contractUploadId: string): string {
  return `teacher-contracts/${teacherId}/${contractUploadId}`;
}

/** True when the bytes start like a PDF. */
export function looksLikePdf(head: Uint8Array): boolean {
  return PDF_MAGIC.every((byte, index) => head[index] === byte);
}

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

/**
 * The name the person sees on the file. Only what is after the last slash or
 * backslash — some browsers hand over a path — and never empty.
 */
const ContractFileNameField = z
  .string()
  .transform((value) => value.split(/[\\/]/).pop()!.trim())
  .pipe(z.string().min(1, "required").max(FILE_NAME_MAX, "too_long"));

/**
 * What filing needs besides the bytes: the name to show and the period the
 * contract covers. File, start and end come together or not at all (CLAUDE.md
 * §1) — all three are required here, and the bytes are checked by the usecase.
 */
export const FileTeacherContractSchema = z
  .object({
    fileName: ContractFileNameField,
    startsOn: CalendarDayField,
    endsOn: CalendarDayField,
  })
  .superRefine((value, ctx) => {
    if (value.startsOn.getTime() > value.endsOn.getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endsOn"], message: "invalid" });
    }
  });

export type FileTeacherContractDTO = z.input<typeof FileTeacherContractSchema>;

export const TeacherContractPropsSchema = BaseModelPropsSchema.extend({
  teacherId: z.string().uuid(),
  objectKey: z.string().min(1),
  fileName: z.string().min(1),
  fileSizeBytes: z.number().int().positive(),
  startsOn: z.coerce.date(),
  endsOn: z.coerce.date(),
  /** Better Auth "user".id of whoever filed it. */
  uploadedBy: z.string().min(1),
});

export type TeacherContractProps = z.infer<typeof TeacherContractPropsSchema>;

/**
 * A signed contract, filed (OOC-81). Append-only, like the table (0025):
 * correcting a filing is filing a new one, and the newest is the one in force.
 * No `update`, no `softDelete` — there is nothing on it to change.
 */
export class TeacherContract extends BaseModel {
  public readonly teacherId: string;
  public readonly objectKey: string;
  public readonly fileName: string;
  public readonly fileSizeBytes: number;
  public readonly startsOn: Date;
  public readonly endsOn: Date;
  public readonly uploadedBy: string;

  constructor(props: TeacherContractProps) {
    super(props);
    this.teacherId = props.teacherId;
    this.objectKey = props.objectKey;
    this.fileName = props.fileName;
    this.fileSizeBytes = props.fileSizeBytes;
    this.startsOn = props.startsOn;
    this.endsOn = props.endsOn;
    this.uploadedBy = props.uploadedBy;
  }

  /** Throws `InvalidFieldsError` (paths under `contract.`) when the form breaks a rule. */
  static file(params: {
    id: string;
    teacherId: string;
    objectKey: string;
    fileSizeBytes: number;
    uploadedBy: string;
    contract: FileTeacherContractDTO;
  }): TeacherContract {
    const parsed = FileTeacherContractSchema.safeParse(params.contract);
    if (!parsed.success) throw new InvalidFieldsError(toFieldErrors(parsed.error.issues, "contract"));

    return new TeacherContract({
      id: params.id,
      teacherId: params.teacherId,
      objectKey: params.objectKey,
      fileName: parsed.data.fileName,
      fileSizeBytes: params.fileSizeBytes,
      startsOn: parsed.data.startsOn,
      endsOn: parsed.data.endsOn,
      uploadedBy: params.uploadedBy,
    });
  }
}
