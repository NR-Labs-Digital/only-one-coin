import { v7 as uuid } from "uuid";
import { z } from "zod";
import { InvalidFieldsError } from "../../shared/base/errors/InvalidFieldsError.js";
import { SoftDeletableModel, SoftDeletableModelPropsSchema } from "../../shared/base/SoftDeletableModel.js";
import { EmailField, toFieldErrors } from "../../student/fields.js";

/**
 * What a person types as the password: any characters, as Google takes them —
 * nothing trimmed or normalized, since a changed character is a wrong
 * password. Up to 100, Google's own ceiling.
 */
export const ClassroomPasswordField = z
  .string()
  .min(1, "required")
  .max(100, "too_long")
  .refine((value) => value.trim() !== "", "required");

export const ClassroomAccountFieldsSchema = z.object({
  email: EmailField,
  password: ClassroomPasswordField,
});

export type ClassroomAccountFieldsDTO = z.input<typeof ClassroomAccountFieldsSchema>;

/** A change: the e-mail, the password, or both. Left out = kept. */
export const ClassroomAccountChangesSchema = ClassroomAccountFieldsSchema.partial();

export type ClassroomAccountChangesDTO = z.input<typeof ClassroomAccountChangesSchema>;

export const ClassroomAccountPropsSchema = SoftDeletableModelPropsSchema.extend({
  email: z.string().email(),
  /** Sealed by ICredentialCipher — never the password itself. */
  passwordCiphertext: z.string().min(1),
  passwordChangedAt: z.coerce.date(),
  /** The last time a teacher stopped using the account; null if none ever did. */
  releasedAt: z.coerce.date().nullable(),
});

export type ClassroomAccountProps = z.infer<typeof ClassroomAccountPropsSchema>;

export type ClassroomAccountField = "email" | "password";

/**
 * A shared Google Classroom login (OOC-196). The institution lends one Google
 * account to several teachers at a time — up to `classroom_account_max_teachers`
 * — and the teacher portal shows its e-mail and password to the teachers who
 * use it, so the password is kept sealed rather than hashed.
 */
export class ClassroomAccount extends SoftDeletableModel {
  public email: string;
  public passwordCiphertext: string;
  public passwordChangedAt: Date;
  public releasedAt: Date | null;

  constructor(props: ClassroomAccountProps) {
    super(props);
    this.email = props.email;
    this.passwordCiphertext = props.passwordCiphertext;
    this.passwordChangedAt = props.passwordChangedAt;
    this.releasedAt = props.releasedAt;
  }

  /**
   * A teacher stopped using the account after its password last changed:
   * they still know it. What the client does every time somebody leaves is
   * change it — the screen asks for that while this is true.
   */
  get passwordChangeDue(): boolean {
    return this.releasedAt !== null && this.releasedAt > this.passwordChangedAt;
  }

  /** Checks the fields; the caller seals the password and builds the account. */
  static parse(dto: ClassroomAccountFieldsDTO): z.output<typeof ClassroomAccountFieldsSchema> {
    const result = ClassroomAccountFieldsSchema.safeParse(dto);
    if (!result.success) throw new InvalidFieldsError(toFieldErrors(result.error.issues, "classroomAccount"));
    return result.data;
  }

  static parseChanges(dto: ClassroomAccountChangesDTO): z.output<typeof ClassroomAccountChangesSchema> {
    const result = ClassroomAccountChangesSchema.safeParse(dto);
    if (!result.success) throw new InvalidFieldsError(toFieldErrors(result.error.issues, "classroomAccount"));
    return result.data;
  }

  static create(params: { email: string; passwordCiphertext: string; at?: Date }): ClassroomAccount {
    const at = params.at ?? new Date();
    return new ClassroomAccount({
      id: uuid(),
      email: params.email,
      passwordCiphertext: params.passwordCiphertext,
      passwordChangedAt: at,
      releasedAt: null,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    });
  }

  /** False when it is the same e-mail, so nothing is written. */
  changeEmail(email: string, at: Date = new Date()): boolean {
    if (email === this.email) return false;
    this.email = email;
    this.touch(at);
    return true;
  }

  /**
   * Always counts as a change: the cipher seals the same password differently
   * each time, and retyping it is how coordination says "it was changed".
   */
  changePassword(passwordCiphertext: string, at: Date = new Date()): void {
    this.passwordCiphertext = passwordCiphertext;
    this.passwordChangedAt = at;
    this.touch(at);
  }
}
