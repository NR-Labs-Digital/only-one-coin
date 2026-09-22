// TODO: switch to native crypto.randomUUIDv7() once engines.node requires >=26 (LTS ~out/2026)
import { v7 as uuid } from "uuid";
import { z } from "zod";
import {
  BASE_PROPS_KEYS,
  SoftDeletableModel,
  SoftDeletableModelPropsSchema,
} from "../shared/base/SoftDeletableModel.js";

export const NationalIdTypeSchema = z.enum(["DNI", "CE", "passport"]);
export type NationalIdType = z.infer<typeof NationalIdTypeSchema>;

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

export const CreateStudentSchema = StudentPropsSchema.omit(BASE_PROPS_KEYS);

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
    const today = new Date();
    let age = today.getUTCFullYear() - this.birthDate.getUTCFullYear();

    const hasHadBirthdayThisYear =
      today.getUTCMonth() > this.birthDate.getUTCMonth() ||
      (today.getUTCMonth() === this.birthDate.getUTCMonth() &&
        today.getUTCDate() >= this.birthDate.getUTCDate());

    if (!hasHadBirthdayThisYear) {
      age -= 1;
    }

    return age;
  }

  /** Whether the student is under Student.MAJORITY_AGE as of today — drives
   * whether a guardian is required (CLAUDE.md §1). */
  get isMinor(): boolean {
    return this.ageInYears < Student.MAJORITY_AGE;
  }

  static create(dto: CreateStudentDTO): Student {
    const result = CreateStudentSchema.safeParse(dto);

    if (!result.success) {
      throw new Error("Invalid data");
    }

    return new Student({
      id: uuid(),
      ...result.data,
    });
  }
}
