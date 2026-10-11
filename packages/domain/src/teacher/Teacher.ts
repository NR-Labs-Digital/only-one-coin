import { v7 as uuid } from "uuid";
import { z } from "zod";
import { WeeklySlotSchema, type WeeklySlot } from "../catalog/ClassGroup.js";
import { InvalidFieldsError } from "../shared/base/errors/InvalidFieldsError.js";
import { SoftDeletableModel, SoftDeletableModelPropsSchema } from "../shared/base/SoftDeletableModel.js";
import {
  AddressLineField,
  CityField,
  CountryCodeField,
  EmailField,
  LanguageField,
  NationalIdField,
  NationalIdTypeSchema,
  type NationalIdType,
  PersonNameField,
  PhoneField,
  refineNationalId,
  refineRegion,
  RegionField,
  toFieldErrors,
} from "../student/fields.js";

/**
 * On the roster or out of it. Leaving is `inactive`, never a deleted record:
 * whoever ran a class group and signed its grades is still pointed at by them
 * (CLAUDE.md §1). The database refuses the DELETE either way (0025).
 */
export const TeacherStatusSchema = z.enum(["active", "inactive"]);
export type TeacherStatus = z.infer<typeof TeacherStatusSchema>;

/** What a stored record looks like. */
export const TeacherPropsSchema = SoftDeletableModelPropsSchema.extend({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  nationalIdType: NationalIdTypeSchema,
  nationalId: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  nationality: z.string().length(2),
  country: z.string().length(2),
  region: z.string().min(1).nullable(),
  city: z.string().min(1),
  addressLine: z.string().min(1),
  status: TeacherStatusSchema,
  /** The panel account (Better Auth "user".id); null until one is linked. */
  userId: z.string().min(1).nullable(),
  /** Catalog text, the same as `courses.language` — never a translated code. */
  languages: z.array(z.string().min(1)),
  /** Weekly windows in America/Lima — the shape a class group's slots use. */
  availability: z.array(WeeklySlotSchema),
});

export type TeacherProps = z.infer<typeof TeacherPropsSchema>;

/**
 * What a new or rewritten file must satisfy — normalized first, then checked.
 * The e-mail is any provider's: the Gmail rule is the student's, because the
 * class reaches them through Google Classroom.
 */
export const TeacherFieldsSchema = z.object({
  firstName: PersonNameField,
  lastName: PersonNameField,
  nationalIdType: NationalIdTypeSchema,
  nationalId: NationalIdField,
  email: EmailField,
  phone: PhoneField,
  nationality: CountryCodeField,
  country: CountryCodeField,
  region: RegionField.nullable(),
  city: CityField,
  addressLine: AddressLineField,
  languages: z.array(LanguageField),
  availability: z.array(z.unknown()),
});

/** The same language listed twice, ignoring case. */
function refineLanguages(value: { languages: string[] }, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  value.languages.forEach((language, index) => {
    const key = language.toLocaleLowerCase("es");
    if (seen.has(key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["languages", index], message: "invalid" });
    }
    seen.add(key);
  });
}

/**
 * Each window must run forwards, and two windows of the same day may not
 * overlap — a class group is allocated into one window, so an overlap is two
 * answers to the same question. Windows that touch (19–21, 21–22) are fine.
 */
function refineAvailability(value: { availability: unknown[] }, ctx: z.RefinementCtx): void {
  const windows: (WeeklySlot & { index: number })[] = [];
  value.availability.forEach((raw, index) => {
    const parsed = WeeklySlotSchema.safeParse(raw);
    if (!parsed.success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["availability", index], message: "invalid" });
      return;
    }
    windows.push({ ...parsed.data, index });
  });

  const byStart = [...windows].sort(
    (a, b) => a.weekday.localeCompare(b.weekday) || a.startTime.localeCompare(b.startTime) || a.index - b.index,
  );
  for (let i = 1; i < byStart.length; i += 1) {
    const previous = byStart[i - 1]!;
    const current = byStart[i]!;
    if (current.weekday === previous.weekday && current.startTime < previous.endTime) {
      const later = Math.max(previous.index, current.index);
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["availability", later], message: "invalid" });
    }
  }
}

export const CreateTeacherSchema = TeacherFieldsSchema.superRefine(refineNationalId)
  .superRefine(refineRegion)
  .superRefine(refineLanguages)
  .superRefine(refineAvailability)
  .transform((value) => ({ ...value, availability: value.availability as WeeklySlot[] }));

export type CreateTeacherDTO = z.input<typeof CreateTeacherSchema>;

export class Teacher extends SoftDeletableModel {
  public firstName: string;
  public lastName: string;
  public nationalIdType: NationalIdType;
  public nationalId: string;
  public email: string;
  public phone: string;
  public nationality: string;
  public country: string;
  public region: string | null;
  public city: string;
  public addressLine: string;
  public status: TeacherStatus;
  public userId: string | null;
  public languages: string[];
  public availability: WeeklySlot[];

  constructor(props: TeacherProps) {
    super(props);
    this.firstName = props.firstName;
    this.lastName = props.lastName;
    this.nationalIdType = props.nationalIdType;
    this.nationalId = props.nationalId;
    this.email = props.email;
    this.phone = props.phone;
    this.nationality = props.nationality;
    this.country = props.country;
    this.region = props.region;
    this.city = props.city;
    this.addressLine = props.addressLine;
    this.status = props.status;
    this.userId = props.userId;
    this.languages = props.languages;
    this.availability = props.availability;
  }

  get isActive(): boolean {
    return this.status === "active";
  }

  /** Out of the roster: stops the contract watch, keeps every record (CLAUDE.md §1). */
  leaveRoster(at: Date = new Date()): void {
    if (this.status === "inactive") return;
    this.status = "inactive";
    this.touch(at);
  }

  rejoinRoster(at: Date = new Date()): void {
    if (this.status === "active") return;
    this.status = "active";
    this.touch(at);
  }

  static create(dto: CreateTeacherDTO): Teacher {
    const result = CreateTeacherSchema.safeParse(dto);

    if (!result.success) {
      throw new InvalidFieldsError(toFieldErrors(result.error.issues, "teacher"));
    }

    return new Teacher({ id: uuid(), ...result.data, status: "active", userId: null });
  }
}
