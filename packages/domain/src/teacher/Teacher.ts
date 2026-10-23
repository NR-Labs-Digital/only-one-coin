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
  availability: z.array(WeeklySlotSchema),
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
 * Two windows of the same day may not overlap — a class group is allocated into
 * one window, so an overlap is two answers to the same question. Windows that
 * touch (19–21, 21–22) are fine. A window that does not run forwards is already
 * refused by `WeeklySlotSchema`, so it is skipped here rather than reported twice.
 */
function refineAvailability(value: { availability: WeeklySlot[] }, ctx: z.RefinementCtx): void {
  const windows = value.availability
    .map((slot, index) => ({ ...slot, index }))
    .filter((slot) => slot.startTime < slot.endTime);

  const byStart = windows.sort(
    (a, b) => a.weekday.localeCompare(b.weekday) || a.startTime.localeCompare(b.startTime) || a.index - b.index,
  );
  // Compare against the window of the day that runs latest so far, not just the
  // previous one: a short window nested inside a long one (09–18 holding 10–11
  // and 12–13) must still be caught after the first nested window.
  let furthest: (typeof byStart)[number] | undefined;
  for (const current of byStart) {
    if (furthest?.weekday !== current.weekday) {
      furthest = current;
      continue;
    }
    if (current.startTime < furthest.endTime) {
      const later = Math.max(furthest.index, current.index);
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["availability", later], message: "invalid" });
    }
    if (current.endTime > furthest.endTime) furthest = current;
  }
}

export const CreateTeacherSchema = TeacherFieldsSchema.superRefine(refineNationalId)
  .superRefine(refineRegion)
  .superRefine(refineLanguages)
  .superRefine(refineAvailability);

export type CreateTeacherDTO = z.input<typeof CreateTeacherSchema>;

/**
 * The file without the week (OOC-78): who they are, how to reach them, where
 * they live and what they may teach. The week is its own edit — it changes far
 * more often, and from a different conversation.
 */
export const TeacherDataSchema = TeacherFieldsSchema.omit({ availability: true })
  .superRefine(refineNationalId)
  .superRefine(refineRegion)
  .superRefine(refineLanguages);

export type TeacherDataDTO = z.input<typeof TeacherDataSchema>;

export const TeacherAvailabilitySchema = z
  .object({ availability: z.array(WeeklySlotSchema) })
  .superRefine(refineAvailability);

/** Same set of languages, whatever the order they were ticked in. */
function sameLanguages(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sorted = (list: string[]) => [...list].sort().join("\u0000");
  return sorted(a) === sorted(b);
}

/** Same week, whatever the order the windows were listed in. */
function sameWeek(a: WeeklySlot[], b: WeeklySlot[]): boolean {
  if (a.length !== b.length) return false;
  const key = (list: WeeklySlot[]) =>
    list
      .map((slot) => `${slot.weekday} ${slot.startTime} ${slot.endTime}`)
      .sort()
      .join("|");
  return key(a) === key(b);
}

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

  /**
   * A staff correction to the file (OOC-78), held to what registration is held
   * to. Returns the names of the fields that changed — what the audit line
   * records, never the values (CLAUDE.md §8, OOC-74).
   */
  rewrite(dto: TeacherDataDTO): (keyof TeacherDataDTO)[] {
    const result = TeacherDataSchema.safeParse(dto);

    if (!result.success) {
      throw new InvalidFieldsError(toFieldErrors(result.error.issues, "teacher"));
    }

    const next = result.data;
    const changed: (keyof TeacherDataDTO)[] = [];
    for (const key of Object.keys(next) as (keyof TeacherDataDTO)[]) {
      const same =
        key === "languages" ? sameLanguages(this.languages, next.languages) : this[key] === next[key];
      if (same) continue;
      (this as Record<string, unknown>)[key] = next[key];
      changed.push(key);
    }

    if (changed.length > 0) this.touch();
    return changed;
  }

  /** Replaces the week. False when it is the same week, so nothing is written. */
  replaceAvailability(availability: WeeklySlot[]): boolean {
    const result = TeacherAvailabilitySchema.safeParse({ availability });

    if (!result.success) {
      throw new InvalidFieldsError(toFieldErrors(result.error.issues, "teacher"));
    }

    if (sameWeek(this.availability, result.data.availability)) return false;
    this.availability = result.data.availability;
    this.touch();
    return true;
  }

  static create(dto: CreateTeacherDTO): Teacher {
    const result = CreateTeacherSchema.safeParse(dto);

    if (!result.success) {
      throw new InvalidFieldsError(toFieldErrors(result.error.issues, "teacher"));
    }

    return new Teacher({ id: uuid(), ...result.data, status: "active", userId: null });
  }
}
