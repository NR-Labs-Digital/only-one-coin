import { z } from "zod";

/*
 * The person-record field rules — one copy (and, at the end, the complaints
 * book form, which is made of them), read by `apps/api` (through the
 * entity schemas in this folder) and by `apps/app` (the public checkout and the
 * backoffice registration form, through the `@ooc/domain/fields` subpath).
 *
 * This file is imported raw by the Next.js bundle, so it stays self-contained:
 * `zod` and nothing else, no relative import. A rule that needs more than that
 * belongs in the entity, not here.
 *
 * Every rule answers with a code from `FIELD_ERROR_CODES`, never a sentence:
 * the text lives in the locale files of whoever shows it (CLAUDE.md §4).
 */

export const NationalIdTypeSchema = z.enum(["DNI", "CE", "passport"]);
export type NationalIdType = z.infer<typeof NationalIdTypeSchema>;

export const FIELD_ERROR_CODES = [
  "required",
  "too_long",
  "national_id_format",
  "phone_format",
  "email_format",
  "email_must_be_gmail",
  "email_gmail_username_invalid",
  "birth_date_range",
  "operation_format",
  "invalid",
] as const;

export const FieldErrorCodeSchema = z.enum(FIELD_ERROR_CODES);
export type FieldErrorCode = z.infer<typeof FieldErrorCodeSchema>;

/** One refused field: the dotted path inside the request body and why. */
export interface FieldError {
  path: string;
  code: FieldErrorCode;
}

/** Longest value each free-text field takes. Generous on purpose — they exist
 * to stop a megabyte in a name column, not to second-guess a long surname. */
export const FIELD_LIMITS = {
  name: 80,
  city: 80,
  region: 80,
  email: 254,
  phone: 30,
  methodDetail: 80,
  address: 160,
  language: 40,
} as const;

/* -------------------------------------------------------------------------- */
/* Normalization — runs before every rule and before every write              */
/* -------------------------------------------------------------------------- */

/** Trimmed, with inner runs of whitespace folded to one space. */
export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Separators out, letters up. `12.345.678` and `12345678` are the same DNI,
 * and the "one document, one record" lookup (CLAUDE.md §1, 21/09/2026)
 * compares the stored string — two spellings would be two people.
 */
export function normalizeNationalId(value: string): string {
  return value.replace(/[\s.\-]/g, "").toUpperCase();
}

/* -------------------------------------------------------------------------- */
/* Rules                                                                      */
/* -------------------------------------------------------------------------- */

/** DNI is 8 digits; CE and passport are alphanumeric and vary by country. */
const NATIONAL_ID_PATTERNS: Record<NationalIdType, RegExp> = {
  DNI: /^\d{8}$/,
  CE: /^[A-Z0-9]{9,12}$/,
  passport: /^[A-Z0-9]{6,12}$/,
};

/** Format of an already-normalized document number, by type. */
export function nationalIdIssue(type: NationalIdType, nationalId: string): FieldErrorCode | null {
  if (nationalId === "") return "required";
  return NATIONAL_ID_PATTERNS[type].test(nationalId) ? null : "national_id_format";
}

/**
 * Digit floor for a mobile number. Deliberately low — the Asociación does
 * enroll students abroad, and a rule that only knows Lima turns a paying
 * student away at the last step.
 */
export const PHONE_MIN_DIGITS = 6;

export function hasEnoughPhoneDigits(phone: string): boolean {
  return phone.replace(/\D/g, "").length >= PHONE_MIN_DIGITS;
}

/**
 * The student's address has to be a personal Gmail account (CLAUDE.md §1):
 * class access arrives through Google Classroom. Which domains count, and
 * whether the backoffice registration is held to it too, is OOC-65's call —
 * this is the rule the public checkout already applied.
 */
export function isGmail(email: string): boolean {
  return /@gmail\.com$/.test(normalizeEmail(email));
}

/**
 * Gmail's own username rules (6–30 characters; letters, digits and dots; no
 * dot at either end or two in a row). An address that breaks them cannot
 * exist, so it is refused wherever an e-mail is written — student or guardian,
 * checkout or backoffice. Only `@gmail.com` is judged: other providers have
 * their own rules and the Gmail requirement itself is the checkout's
 * (`refineGmail`). `+` aliases are refused on purpose: they deliver to the same
 * inbox, but Classroom needs the account itself.
 */
export function gmailUsernameIssue(email: string): FieldErrorCode | null {
  const normalized = normalizeEmail(email);
  if (!isGmail(normalized)) return null;
  const username = normalized.slice(0, -"@gmail.com".length);
  const valid =
    username.length >= 6 &&
    username.length <= 30 &&
    /^[a-z0-9.]+$/.test(username) &&
    !username.startsWith(".") &&
    !username.endsWith(".") &&
    !username.includes("..");
  return valid ? null : "email_gmail_username_invalid";
}

/** Domain typos people actually make, each to the domain they meant. */
const DOMAIN_TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gmaill.com": "gmail.com",
  "gnail.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.cm": "gmail.com",
  "gmail.om": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmai.com": "hotmail.com",
  "hotmail.co": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "outlok.com": "outlook.com",
  "outlook.co": "outlook.com",
  "outlook.con": "outlook.com",
  "yaho.com": "yahoo.com",
  "yahoo.co": "yahoo.com",
  "yahoo.con": "yahoo.com",
};

/** `name123gmail.com` — the "@" that never got typed (legacy import, parse-row.ts). */
const MISSING_AT = /^(.+?)(gmail|hotmail|outlook|yahoo)\.com$/;

/**
 * "Did you mean ...?" — the corrected address, or null when there is nothing to
 * suggest. A suggestion, never a refusal: the list can never be complete, so
 * nothing is rejected for missing from it.
 */
export function suggestEmailDomain(email: string): string | null {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf("@");
  if (at === -1) {
    const match = MISSING_AT.exec(normalized);
    return match ? `${match[1]}@${match[2]}.com` : null;
  }
  if (at === 0) return null;
  const fix = DOMAIN_TYPOS[normalized.slice(at + 1)];
  return fix ? `${normalized.slice(0, at)}@${fix}` : null;
}

export const AGE_RANGE = { min: 0, max: 120 } as const;

/** Full years old on `now`, UTC — the "has the birthday happened yet" rule. */
export function ageOn(birthDate: Date, now: Date = new Date()): number {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const hasHadBirthdayThisYear =
    now.getUTCMonth() > birthDate.getUTCMonth() ||
    (now.getUTCMonth() === birthDate.getUTCMonth() && now.getUTCDate() >= birthDate.getUTCDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

export function isPlausibleAge(age: number): boolean {
  return age >= AGE_RANGE.min && age <= AGE_RANGE.max;
}

/** Operation numbers run 6–20 characters across Yape, Plin and the banks. */
const OPERATION_NUMBER = /^[A-Za-z0-9-]{6,20}$/;

/* -------------------------------------------------------------------------- */
/* Field schemas — normalize, then check                                      */
/* -------------------------------------------------------------------------- */

const requiredText = (max: number) =>
  z.string().transform(normalizeText).pipe(z.string().min(1, "required").max(max, "too_long"));

export const PersonNameField = requiredText(FIELD_LIMITS.name);
export const CityField = requiredText(FIELD_LIMITS.city);
export const RegionField = requiredText(FIELD_LIMITS.region);
export const MethodDetailField = requiredText(FIELD_LIMITS.methodDetail);
export const AddressLineField = requiredText(FIELD_LIMITS.address);
export const LanguageField = requiredText(FIELD_LIMITS.language);

/** ISO 3166-1 alpha-2, upper-cased. */
export const CountryCodeField = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .pipe(z.string().length(2, "invalid"));

/** Object-level: inside Peru the address names its departamento. */
export function refineRegion(value: { country: string; region: string | null }, ctx: z.RefinementCtx): void {
  if (value.country === "PE" && value.region === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["region"], message: "required" });
  }
}

export const EmailField = z
  .string()
  .transform(normalizeEmail)
  .pipe(
    z
      .string()
      .min(1, "required")
      .max(FIELD_LIMITS.email, "too_long")
      .email("email_format")
      .refine((email) => gmailUsernameIssue(email) === null, "email_gmail_username_invalid"),
  );

/** Format is checked against the type at object level (`refineNationalId`). */
export const NationalIdField = z.string().transform(normalizeNationalId).pipe(z.string().min(1, "required"));

export const PhoneField = z
  .string()
  .transform(normalizeText)
  .pipe(
    z
      .string()
      .min(1, "required")
      .max(FIELD_LIMITS.phone, "too_long")
      .refine(hasEnoughPhoneDigits, "phone_format"),
  );

export const BirthDateField = z.coerce
  .date({ errorMap: () => ({ message: "birth_date_range" }) })
  .refine((birthDate) => isPlausibleAge(ageOn(birthDate)), "birth_date_range");

export const OperationNumberField = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1, "required").regex(OPERATION_NUMBER, "operation_format"));

/** Object-level: the document's format depends on its type. */
export function refineNationalId(
  value: { nationalIdType: NationalIdType; nationalId: string },
  ctx: z.RefinementCtx,
): void {
  const code = nationalIdIssue(value.nationalIdType, value.nationalId);
  // An empty number already failed as `required` on the field itself.
  if (code && code !== "required") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nationalId"], message: code });
  }
}

/** Object-level, public checkout only (see `isGmail`). */
export function refineGmail(value: { email: string }, ctx: z.RefinementCtx): void {
  if (!isGmail(value.email)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["email"], message: "email_must_be_gmail" });
  }
}

/* -------------------------------------------------------------------------- */
/* The complaints book (Libro de Reclamaciones, OOC-63)                       */
/* -------------------------------------------------------------------------- */
/*
 * Lives here, not in its own folder, because the public form validates with
 * it in the browser (`@ooc/domain/fields`) and this is the one file the bundle
 * may import — and it reuses the person rules above (document, phone, e-mail).
 * The e-mail is any provider's: the Gmail rule is the enrolling student's.
 */

/** Reclamación (the product or service) or queja (anything else, the service at the counter included). */
export const COMPLAINT_KINDS = ["claim", "grievance"] as const;
export type ComplaintKind = (typeof COMPLAINT_KINDS)[number];

export const COMPLAINT_GOOD_TYPES = ["product", "service"] as const;
export type ComplaintGoodType = (typeof COMPLAINT_GOOD_TYPES)[number];

export const COMPLAINT_TEXT_LIMITS = {
  description: 1000,
  detail: 3000,
  request: 2000,
  reference: 160,
} as const;

/** S/100,000 — a ceiling against a typo, not a business rule. */
export const COMPLAINT_MAX_AMOUNT_CENTS = 10_000_000;

const optionalText = (max: number) =>
  z
    .string()
    .transform(normalizeText)
    .pipe(z.string().max(max, "too_long"))
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null);

/** Free text kept as typed: only the ends are trimmed — the line breaks are the person's. */
const longText = (max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1, "required").max(max, "too_long"));

/** A calendar day, `YYYY-MM-DD`, that exists. */
const CalendarDayField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "invalid")
  .refine((value) => {
    const day = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
  }, "invalid");

const ComplaintDocumentSchema = {
  nationalIdType: NationalIdTypeSchema,
  nationalId: NationalIdField,
};

/** The consumer who files — not necessarily a student, and never looked up here. */
export const ComplaintConsumerSchema = z
  .object({
    firstName: PersonNameField,
    lastName: PersonNameField,
    /** Optional: not every CE carries a second surname. */
    secondLastName: optionalText(FIELD_LIMITS.name),
    ...ComplaintDocumentSchema,
    phone: PhoneField,
    email: EmailField,
    department: RegionField,
    province: RegionField,
    district: RegionField,
    address: AddressLineField,
    addressReference: optionalText(COMPLAINT_TEXT_LIMITS.reference),
    isMinor: z.boolean(),
  })
  .superRefine(refineNationalId);

/** A minor files through a parent or guardian, whose name and document the sheet carries. */
export const ComplaintGuardianSchema = z
  .object({
    firstName: PersonNameField,
    lastName: PersonNameField,
    ...ComplaintDocumentSchema,
  })
  .superRefine(refineNationalId);

export const ComplaintFormSchema = z
  .object({
    kind: z.enum(COMPLAINT_KINDS),
    consumer: ComplaintConsumerSchema,
    guardian: ComplaintGuardianSchema.nullable(),
    goodType: z.enum(COMPLAINT_GOOD_TYPES),
    /** Optional: a queja about the service at the counter has no amount. */
    amountCents: z.number().int("invalid").min(0, "invalid").max(COMPLAINT_MAX_AMOUNT_CENTS, "invalid").nullable(),
    description: longText(COMPLAINT_TEXT_LIMITS.description),
    purchasedOn: CalendarDayField.nullable(),
    detail: longText(COMPLAINT_TEXT_LIMITS.detail),
    request: longText(COMPLAINT_TEXT_LIMITS.request),
    /** The sworn statement that the facts are true (declaración jurada). */
    truthfulnessAccepted: z.literal(true, { errorMap: () => ({ message: "required" }) }),
    /** The privacy notice (Ley 29733); its version and the IP are stamped by the server. */
    privacyAccepted: z.literal(true, { errorMap: () => ({ message: "required" }) }),
  })
  .superRefine((value, ctx) => {
    // The guardian block is the minor's, and only the minor's.
    if (value.consumer.isMinor && value.guardian === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["guardian"], message: "required" });
    }
    if (!value.consumer.isMinor && value.guardian !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["guardian"], message: "invalid" });
    }
  });

export type ComplaintFormInput = z.input<typeof ComplaintFormSchema>;
export type ComplaintForm = z.output<typeof ComplaintFormSchema>;

/**
 * Typed soles to cents without a float: "80", "80.5", "80,50", "S/ 1,250.00".
 * Null for an empty field, `"invalid"` for anything that is not an amount.
 */
export function parseSolesToCents(typed: string): number | null | "invalid" {
  const cleaned = typed.replace(/s\/\.?/gi, "").replace(/\s/g, "");
  if (cleaned === "") return null;
  // The last separator followed by one or two digits is the decimal one.
  const match = /^(\d{1,3}(?:[.,]?\d{3})*|\d+)(?:[.,](\d{1,2}))?$/.exec(cleaned);
  if (!match) return "invalid";
  const units = Number(match[1]!.replace(/[.,]/g, ""));
  const cents = Number((match[2] ?? "").padEnd(2, "0"));
  const total = units * 100 + cents;
  return Number.isSafeInteger(total) ? total : "invalid";
}

/* -------------------------------------------------------------------------- */
/* Reading the result                                                         */
/* -------------------------------------------------------------------------- */

const KNOWN_CODES = new Set<string>(FIELD_ERROR_CODES);

/**
 * Zod issues → `{path, code}`. Every rule above sets its code as the issue
 * message; anything else zod raises on its own (a missing key, a wrong type, an
 * enum outside its list) is `required` when the value is absent and `invalid`
 * otherwise — the client is malformed, not the person.
 */
export function toFieldErrors(issues: readonly z.ZodIssue[], prefix?: string): FieldError[] {
  return issues.map((issue) => {
    const path = [...(prefix ? [prefix] : []), ...issue.path].join(".");
    if (KNOWN_CODES.has(issue.message)) return { path, code: issue.message as FieldErrorCode };
    if (issue.code === z.ZodIssueCode.invalid_type && issue.received === "undefined") {
      return { path, code: "required" };
    }
    return { path, code: "invalid" };
  });
}

/** The first problem with one value against one field schema, or null. */
export function issueOf(schema: z.ZodTypeAny, value: unknown): FieldErrorCode | null {
  const result = schema.safeParse(value);
  if (result.success) return null;
  return toFieldErrors(result.error.issues)[0]?.code ?? "invalid";
}
