// TODO: switch to native crypto.randomUUIDv7() once engines.node requires >=26 (LTS ~out/2026)
import { v7 as uuid } from "uuid";
import { z } from "zod";
import { InvalidFieldsError } from "../shared/base/errors/InvalidFieldsError.js";
import { SoftDeletableModel, SoftDeletableModelPropsSchema } from "../shared/base/SoftDeletableModel.js";
import {
  ageOn,
  BirthDateField,
  CityField,
  CountryCodeField,
  EmailField,
  NationalIdField,
  NationalIdTypeSchema,
  type NationalIdType,
  PersonNameField,
  PhoneField,
  refineNationalId,
  refineRegion,
  RegionField,
  toFieldErrors,
} from "./fields.js";

export { NationalIdTypeSchema, type NationalIdType };

/**
 * What a stored record looks like. Loose on purpose: rows written before the
 * field rules existed (and the legacy import) still have to load. What a
 * *new* record must satisfy is `CreateStudentSchema`, below.
 */
export const StudentPropsSchema = SoftDeletableModelPropsSchema.extend({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  nationalIdType: NationalIdTypeSchema,
  nationalId: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  birthDate: z.coerce.date(),
  // ISO 3166-1 alpha-2.
  country: z.string().length(2),
  // First-level division ("departamento" in Peru). Null outside it.
  region: z.string().min(1).nullable(),
  city: z.string().min(1),
});

/**
 * What a new or rewritten record must satisfy — normalized first, then checked
 * (`fields.ts`). The object without the cross-field rules is exported for
 * routes that need to extend it; anything parsing a whole student uses
 * `CreateStudentSchema`.
 */
export const StudentFieldsSchema = z.object({
  firstName: PersonNameField,
  lastName: PersonNameField,
  nationalIdType: NationalIdTypeSchema,
  nationalId: NationalIdField,
  email: EmailField,
  phone: PhoneField,
  birthDate: BirthDateField,
  // ISO 3166-1 alpha-2.
  country: CountryCodeField,
  // First-level division ("departamento" in Peru). Null outside it.
  region: RegionField.nullable(),
  city: CityField,
});

export const CreateStudentSchema = StudentFieldsSchema.superRefine(refineNationalId).superRefine(refineRegion);

export type StudentProps = z.infer<typeof StudentPropsSchema>;
export type CreateStudentDTO = z.infer<typeof CreateStudentSchema>;

export class Student extends SoftDeletableModel {
  // Peru's Código Civil sets the age of majority at 18 — same value the
  // backoffice mock already computes against
  // (apps/app/.../students/new-student-form.tsx, MAJORITY_AGE).
  static readonly MAJORITY_AGE = 18;

  public firstName: string;
  public lastName: string;
  public nationalIdType: NationalIdType;
  public nationalId: string;
  public email: string;
  public phone: string;
  public birthDate: Date;
  public country: string;
  public region: string | null;
  public city: string;

  constructor(props: StudentProps) {
    super(props);
    this.firstName = props.firstName;
    this.lastName = props.lastName;
    this.nationalIdType = props.nationalIdType;
    this.nationalId = props.nationalId;
    this.email = props.email;
    this.phone = props.phone;
    this.birthDate = props.birthDate;
    this.country = props.country;
    this.region = props.region;
    this.city = props.city;
  }

  /** Full years old as of today — the same "has the birthday happened yet
   * this year" rule the public checkout uses client-side
   * (apps/app/src/lib/enrollment/checkout.ts, ageFrom). */
  get ageInYears(): number {
    return Student.ageOf(this.birthDate);
  }

  /** Whether the student is under Student.MAJORITY_AGE as of today — drives
   * whether a guardian is required (CLAUDE.md §1). */
  get isMinor(): boolean {
    return Student.isMinorBornOn(this.birthDate);
  }

  /** `ageInYears` for a birth date read off a record that was never
   * rehydrated into a Student (a narrow lookup that only needs the age). */
  static ageOf(birthDate: Date): number {
    return ageOn(birthDate);
  }

  static isMinorBornOn(birthDate: Date): boolean {
    return Student.ageOf(birthDate) < Student.MAJORITY_AGE;
  }

  /**
   * Rewrites the record from a staff correction (OOC-74) and answers which
   * fields actually changed — the audit line names those, never their values,
   * and an empty answer means there is nothing to write. The same rules as a
   * new record: a correction is held to what registration is held to.
   *
   * Name, document and birth date change only through here — the public
   * checkout never rewrites them (decision of 21/09/2026).
   */
  rewrite(dto: CreateStudentDTO): (keyof CreateStudentDTO)[] {
    const result = CreateStudentSchema.safeParse(dto);

    if (!result.success) {
      throw new InvalidFieldsError(toFieldErrors(result.error.issues, "student"));
    }

    const next = result.data;
    const changed: (keyof CreateStudentDTO)[] = [];
    for (const key of Object.keys(next) as (keyof CreateStudentDTO)[]) {
      const before = this[key];
      const after = next[key];
      const same =
        before instanceof Date && after instanceof Date ? before.getTime() === after.getTime() : before === after;
      if (same) continue;
      (this as Record<string, unknown>)[key] = after;
      changed.push(key);
    }

    if (changed.length > 0) this.touch();
    return changed;
  }

  static create(dto: CreateStudentDTO): Student {
    const result = CreateStudentSchema.safeParse(dto);

    if (!result.success) {
      throw new InvalidFieldsError(toFieldErrors(result.error.issues, "student"));
    }

    return new Student({
      id: uuid(),
      ...result.data,
    });
  }
}
