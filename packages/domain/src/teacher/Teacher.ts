import { v7 as uuid } from "uuid";
import { z } from "zod";
import { WeeklySlotSchema, type WeeklySlot } from "../catalog/ClassGroup.js";
import { InvalidFieldsError } from "../shared/base/errors/InvalidFieldsError.js";
import { TeacherOnboardingClosedError } from "./errors.js";
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

/**
 * The part of the file the teacher can fill in on their own, at onboarding
 * (OOC-103): document, phone, origin and address. Coordination may register a
 * file without them — name, e-mail and languages only — and the teacher fills
 * them once, after accepting the invite. Either all of them are on the file or
 * none is (CHECK `teachers_profile_check`, 0073); the region stays optional
 * outside Peru, as it always was.
 */
export const TEACHER_PROFILE_FIELDS = [
  "nationalIdType",
  "nationalId",
  "phone",
  "nationality",
  "country",
  "region",
  "city",
  "addressLine",
] as const;

/** What a stored record looks like. Null profile fields = onboarding pending. */
export const TeacherPropsSchema = SoftDeletableModelPropsSchema.extend({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  nationalIdType: NationalIdTypeSchema.nullable(),
  nationalId: z.string().min(1).nullable(),
  /**
   * The panel invite's and the contract's address. Since OOC-196 it mirrors
   * `personalEmail` on every write; files saved before keep what they had
   * until their next edit.
   */
  email: z.string().email(),
  /**
   * Any provider — the teacher's own mail (OOC-161), required since OOC-196:
   * where the portal invite and the monthly feedback go. Null only on a file
   * saved before it was asked for.
   */
  personalEmail: z.string().email().nullable(),
  phone: z.string().min(1).nullable(),
  nationality: z.string().length(2).nullable(),
  country: z.string().length(2).nullable(),
  region: z.string().min(1).nullable(),
  city: z.string().min(1).nullable(),
  addressLine: z.string().min(1).nullable(),
  status: TeacherStatusSchema,
  /** The panel account (Better Auth "user".id); null until one is linked. */
  userId: z.string().min(1).nullable(),
  /** Catalog text, the same as `courses.language` — never a translated code. */
  languages: z.array(z.string().min(1)),
  /** Weekly windows in America/Lima — the shape a class group's slots use. */
  availability: z.array(WeeklySlotSchema),
  /** The shared Classroom login the teacher uses (OOC-196); null = none. */
  classroomAccountId: z.string().uuid().nullable(),
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
  /**
   * Required since OOC-196 — the address the teacher signs in to the portal
   * with, the contract prints and the monthly feedback goes to. The file's old
   * "Correo" field became the shared Classroom account below; `email` is
   * written from this one.
   */
  personalEmail: EmailField,
  /**
   * The shared Classroom login (OOC-196), picked from the accounts list.
   * Left out of a write, it keeps what the file has; null takes it away.
   */
  classroomAccountId: z.string().uuid().nullable().optional(),
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
 * A file left for the teacher to complete (OOC-103): who they are, where the
 * invite goes and what they are cleared to teach — what coordination knows on
 * the day they hire. The rest arrives through onboarding.
 */
export const PendingTeacherDataSchema = TeacherFieldsSchema.pick({
  firstName: true,
  lastName: true,
  // Coordination's on either kind of file (OOC-161, OOC-196), not the onboarding's.
  personalEmail: true,
  classroomAccountId: true,
  languages: true,
}).superRefine(refineLanguages);

export type PendingTeacherDataDTO = z.input<typeof PendingTeacherDataSchema>;

/**
 * What the teacher sends at onboarding (OOC-103): the profile fields and the
 * week they are free. Name, e-mail and languages stay coordination's — the
 * e-mail is the account's, the languages are a clearance.
 */
export const TeacherOnboardingSchema = TeacherFieldsSchema.pick({
  nationalIdType: true,
  nationalId: true,
  phone: true,
  nationality: true,
  country: true,
  region: true,
  city: true,
  addressLine: true,
  availability: true,
})
  .superRefine(refineNationalId)
  .superRefine(refineRegion)
  .superRefine(refineAvailability);

export type TeacherOnboardingDTO = z.input<typeof TeacherOnboardingSchema>;

/** The field names an onboarding writes — what its audit line records. */
export type TeacherOnboardingField = keyof TeacherOnboardingDTO;

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

/** A field a staff correction can change — what its audit line names. */
export type TeacherDataField = keyof TeacherDataDTO | "email";

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
  public nationalIdType: NationalIdType | null;
  public nationalId: string | null;
  public email: string;
  public personalEmail: string | null;
  public phone: string | null;
  public nationality: string | null;
  public country: string | null;
  public region: string | null;
  public city: string | null;
  public addressLine: string | null;
  public status: TeacherStatus;
  public userId: string | null;
  public languages: string[];
  public availability: WeeklySlot[];
  public classroomAccountId: string | null;

  constructor(props: TeacherProps) {
    super(props);
    this.firstName = props.firstName;
    this.lastName = props.lastName;
    this.nationalIdType = props.nationalIdType;
    this.nationalId = props.nationalId;
    this.email = props.email;
    this.personalEmail = props.personalEmail;
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
    this.classroomAccountId = props.classroomAccountId;
  }

  get isActive(): boolean {
    return this.status === "active";
  }

  /**
   * Whether the profile fields are on the file (OOC-103). False only for a file
   * coordination left for the teacher to complete, until they do — the
   * database keeps the profile all-or-nothing, so the document stands for it.
   */
  get profileComplete(): boolean {
    return this.nationalId !== null;
  }

  /**
   * The teacher's own onboarding (OOC-103): fills the profile fields and the
   * week, once. A complete file refuses it — from then on only coordination
   * corrects the file, as it always did (CLAUDE.md §1, OOC-79). Returns the
   * names of the fields written, for the audit line.
   */
  completeOnboarding(dto: TeacherOnboardingDTO, at: Date = new Date()): TeacherOnboardingField[] {
    if (this.profileComplete) throw new TeacherOnboardingClosedError();

    const result = TeacherOnboardingSchema.safeParse(dto);
    if (!result.success) {
      throw new InvalidFieldsError(toFieldErrors(result.error.issues, "teacher"));
    }

    const next = result.data;
    this.nationalIdType = next.nationalIdType;
    this.nationalId = next.nationalId;
    this.phone = next.phone;
    this.nationality = next.nationality;
    this.country = next.country;
    this.region = next.region;
    this.city = next.city;
    this.addressLine = next.addressLine;
    this.availability = next.availability;
    this.touch(at);

    return Object.keys(next) as TeacherOnboardingField[];
  }

  /** Out of the roster: stops the contract watch, keeps every record (CLAUDE.md §1). */
  leaveRoster(at: Date = new Date()): void {
    if (this.status === "inactive") return;
    this.status = "inactive";
    // Whoever leaves stops using the shared Classroom account (OOC-196): the
    // place frees up, and the account asks for a new password.
    this.classroomAccountId = null;
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
  rewrite(dto: TeacherDataDTO | PendingTeacherDataDTO): TeacherDataField[] {
    // A file still waiting for onboarding can be corrected without the profile
    // (OOC-103) — or completed by coordination, with all of it. A complete file
    // never goes back to pending: the full schema refuses the missing fields.
    const pendingEdit = !this.profileComplete && !("nationalId" in dto && dto.nationalId);
    const result = (pendingEdit ? PendingTeacherDataSchema : TeacherDataSchema).safeParse(dto);

    if (!result.success) {
      throw new InvalidFieldsError(toFieldErrors(result.error.issues, "teacher"));
    }

    const next = result.data as Partial<Record<keyof TeacherDataDTO, unknown>> & { languages?: string[] };
    const changed: TeacherDataField[] = [];
    for (const key of Object.keys(next) as (keyof TeacherDataDTO)[]) {
      if (next[key] === undefined) continue;
      const same =
        key === "languages" ? sameLanguages(this.languages, next.languages ?? []) : this[key] === next[key];
      if (same) continue;
      (this as Record<string, unknown>)[key] = next[key];
      changed.push(key);
    }

    // The invite's and the contract's address follows the personal one
    // (OOC-196) — on a file saved before, from its first edit on.
    if (this.personalEmail !== null && this.email !== this.personalEmail) {
      this.email = this.personalEmail;
      if (!changed.includes("personalEmail")) changed.push("email");
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

    return new Teacher({
      id: uuid(),
      ...result.data,
      email: result.data.personalEmail,
      classroomAccountId: result.data.classroomAccountId ?? null,
      status: "active",
      userId: null,
    });
  }

  /** A file for the teacher to complete at onboarding (OOC-103). */
  static createPending(dto: PendingTeacherDataDTO): Teacher {
    const result = PendingTeacherDataSchema.safeParse(dto);

    if (!result.success) {
      throw new InvalidFieldsError(toFieldErrors(result.error.issues, "teacher"));
    }

    return new Teacher({
      id: uuid(),
      ...result.data,
      email: result.data.personalEmail,
      classroomAccountId: result.data.classroomAccountId ?? null,
      nationalIdType: null,
      nationalId: null,
      phone: null,
      nationality: null,
      country: null,
      region: null,
      city: null,
      addressLine: null,
      availability: [],
      status: "active",
      userId: null,
    });
  }
}
