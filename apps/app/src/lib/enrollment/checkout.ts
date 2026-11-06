import {
  CityField,
  EmailField,
  type FieldErrorCode,
  isGmail,
  isPlausibleAge,
  issueOf,
  NationalIdField,
  nationalIdIssue,
  type NationalIdType,
  normalizeEmail,
  normalizeNationalId,
  OperationNumberField,
  PersonNameField,
  PhoneField,
} from '@ooc/domain/fields'
import { ageFrom } from '@/lib/format'
import { splitPhone } from '@/lib/geo'
import type {
  CatalogClassGroup,
  CatalogCourse,
  CheckoutDraft,
  CourseDraft,
  EnrollmentSource,
  GuardianDraft,
  PaymentDraft,
  PublicCatalog,
  StudentDraft,
  Weekday,
} from './types'

/* -------------------------------------------------------------------------- */
/* Arrival — source, campaign and prefill                                     */
/* -------------------------------------------------------------------------- */

/** Query keys the link may carry. Prefill and attribution only — never a token. */
export const QUERY_KEYS = {
  source: 'src',
  course: 'course',
  classGroup: 'group',
} as const

const CAMPAIGN_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const

/** Longest campaign value we keep; anything past this is somebody probing. */
const MAX_CAMPAIGN_LENGTH = 120

/**
 * Which channel this visit came from (`CLAUDE.md` §5). Closed union, resolved
 * once on arrival: an unrecognised `src` is `web`, never the raw string. The
 * value ends up on an enrollment row, so it can never be free text the visitor
 * chose.
 */
export function resolveSource(raw: string | undefined): EnrollmentSource {
  return raw === 'whatsapp' ? 'whatsapp' : 'web'
}

/**
 * Campaign parameters ride along in their own field, apart from the business
 * one: `source` answers "which channel sells", `utm_*` answers "which post".
 * Mixing them makes the first question unanswerable the day marketing invents
 * a sixth tag.
 */
export function resolveCampaign(
  params: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of CAMPAIGN_KEYS) {
    const value = params[key]
    if (value) out[key] = value.slice(0, MAX_CAMPAIGN_LENGTH)
  }
  return out
}

/**
 * What the seller's link already decided. Validated against the catalog, not
 * trusted: an id that names nothing, or a class group that does not belong to
 * the course, resolves to nothing and the person picks for themselves. The link
 * can preselect; it can never assert.
 *
 * `course` is either a course id (the seller's link, copied from the
 * backoffice) or a landing key (the static landing, which cannot know an id
 * minted per environment — OOC-117). A course with no open class group is not
 * in the public catalog, so its key resolves to nothing too.
 */
export function resolvePrefill(
  catalog: PublicCatalog,
  params: Record<string, string | undefined>,
): CourseDraft {
  const wanted = params[QUERY_KEYS.course]
  const course = wanted
    ? (catalog.courses.find((item) => item.id === wanted || item.landingKey === wanted) ?? null)
    : null
  if (!course) {
    return { languageId: null, courseId: null, startDate: null, classGroupId: null }
  }
  // A link naming a class group that filled up still means its schedule: the
  // seat goes to the next group of the same offer (OOC-140).
  const named = catalog.classGroups.find(
    (item) => item.id === params[QUERY_KEYS.classGroup] && item.courseId === course.id,
  )
  const group = !named
    ? null
    : hasSeat(named)
      ? named
      : (sameOfferGroups(catalog, named.id).find(hasSeat) ?? null)
  return {
    languageId: course.languageId,
    courseId: course.id,
    startDate: group?.startDate ?? null,
    classGroupId: group?.id ?? null,
  }
}

/* -------------------------------------------------------------------------- */
/* Catalog reads                                                              */
/* -------------------------------------------------------------------------- */

export function hasSeat(group: CatalogClassGroup): boolean {
  return group.seatsTaken < group.capacity
}

export function seatsLeft(group: CatalogClassGroup): number {
  return Math.max(0, group.capacity - group.seatsTaken)
}

export function coursesOfLanguage(
  catalog: PublicCatalog,
  languageId: string | null,
): CatalogCourse[] {
  if (!languageId) return []
  return catalog.courses.filter((course) => course.languageId === languageId)
}

export function groupsOfCourse(
  catalog: PublicCatalog,
  courseId: string | null,
): CatalogClassGroup[] {
  if (!courseId) return []
  return catalog.classGroups.filter((group) => group.courseId === courseId)
}

/** One entry per date the course opens on, with what is still available on it. */
export interface StartDateOption {
  startDate: string
  /** Distinct schedules on this date that still have a seat. */
  openGroups: number
  /** Seats left across the whole date — what "almost gone" is measured on. */
  seatsLeft: number
}

/**
 * The dates a course opens on, soonest first.
 *
 * Coordination opens class groups in the panel, and the same course routinely
 * runs "starts this week" next to "starts at the end of the month", each with
 * its own three or four schedules. Reading them as one flat list of twelve
 * options is how somebody picks a convenient hour on a date they cannot make.
 *
 * A date with no seat left on any of its schedules is dropped rather than
 * shown greyed: unlike a single full class group — where seeing that the 07:00
 * exists is worth something — a dead date teaches the reader nothing.
 */
export function startDatesOfCourse(
  catalog: PublicCatalog,
  courseId: string | null,
): StartDateOption[] {
  const byDate = new Map<string, StartDateOption>()
  for (const group of groupsOfCourse(catalog, courseId)) {
    const entry = byDate.get(group.startDate) ?? {
      startDate: group.startDate,
      openGroups: 0,
      seatsLeft: 0,
    }
    if (hasSeat(group)) {
      entry.seatsLeft += seatsLeft(group)
    }
    byDate.set(group.startDate, entry)
  }
  // A schedule, not a class group, is what the reader picks (OOC-140): five
  // class groups at the same hour are one open schedule, not five.
  for (const entry of byDate.values()) {
    entry.openGroups = scheduleOptionsOnStartDate(catalog, courseId, entry.startDate).filter(
      (option) => option.seatsLeft > 0,
    ).length
  }
  return [...byDate.values()]
    .filter((entry) => entry.openGroups > 0)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
}

export function groupsOnStartDate(
  catalog: PublicCatalog,
  courseId: string | null,
  startDate: string | null,
): CatalogClassGroup[] {
  if (!startDate) return []
  return groupsOfCourse(catalog, courseId).filter(
    (group) => group.startDate === startDate,
  )
}

const WEEKDAY_ORDER: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/**
 * What makes two class groups the same offer to the person enrolling: same
 * course, same dates, same week. The code, the teacher and the Classroom are
 * the institution's business — none of them is something the reader chooses.
 */
function offerKey(group: CatalogClassGroup): string {
  const week = [...group.slots]
    .sort(
      (a, b) =>
        WEEKDAY_ORDER.indexOf(a.weekday) - WEEKDAY_ORDER.indexOf(b.weekday) ||
        a.startTime.localeCompare(b.startTime),
    )
    .map((slot) => `${slot.weekday}@${slot.startTime}-${slot.endTime}`)
    .join('|')
  return `${group.courseId}#${group.startDate}#${group.endDate}#${week}`
}

/**
 * The order class groups of one schedule are filled in: by code, which is the
 * order they were opened in (`A-` + a sequence, OOC-?/27-10-2026). The first
 * fills up before the next one takes anybody — coordination opens five groups
 * of thirty, and five groups of six each is not what it asked for.
 */
function byFillOrder(a: CatalogClassGroup, b: CatalogClassGroup): number {
  return (
    a.code.localeCompare(b.code, undefined, { numeric: true }) || a.id.localeCompare(b.id)
  )
}

/**
 * One schedule as the reader sees it (OOC-140). Coordination opens several
 * class groups of the same course at the same hour when demand is larger than
 * one group; to the person enrolling they are one choice, and which group the
 * seat lands in is decided here, never by them.
 */
export interface ScheduleOption {
  key: string
  /** Every class group behind this schedule, in fill order. */
  groups: CatalogClassGroup[]
  /** Seats left across all of them. */
  seatsLeft: number
}

export function scheduleOptionsOnStartDate(
  catalog: PublicCatalog,
  courseId: string | null,
  startDate: string | null,
): ScheduleOption[] {
  const byKey = new Map<string, ScheduleOption>()
  for (const group of groupsOnStartDate(catalog, courseId, startDate)) {
    const key = offerKey(group)
    const option = byKey.get(key) ?? { key, groups: [], seatsLeft: 0 }
    option.groups.push(group)
    option.seatsLeft += seatsLeft(group)
    byKey.set(key, option)
  }
  for (const option of byKey.values()) option.groups.sort(byFillOrder)
  return [...byKey.values()]
}

/** The class group the next seat of this schedule goes to, or null when all are full. */
export function fillTarget(option: ScheduleOption): CatalogClassGroup | null {
  return option.groups.find(hasSeat) ?? null
}

/**
 * The class groups that are the same offer as this one — itself included —
 * in fill order. Where the hold moves to when the catalog on screen said a
 * group had a seat and the server says it no longer does.
 */
export function sameOfferGroups(
  catalog: PublicCatalog,
  groupId: string | null,
): CatalogClassGroup[] {
  const group = groupById(catalog, groupId)
  if (!group) return []
  const key = offerKey(group)
  return catalog.classGroups.filter((item) => offerKey(item) === key).sort(byFillOrder)
}

export function planOfCourse(catalog: PublicCatalog, courseId: string | null) {
  if (!courseId) return null
  return catalog.plans.find((plan) => plan.courseId === courseId) ?? null
}

export function courseById(catalog: PublicCatalog, courseId: string | null) {
  if (!courseId) return null
  return catalog.courses.find((course) => course.id === courseId) ?? null
}

export function groupById(catalog: PublicCatalog, groupId: string | null) {
  if (!groupId) return null
  return catalog.classGroups.find((group) => group.id === groupId) ?? null
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Field-level problems, keyed by field name. The value is an i18n key inside
 * `enrollment.error`, never a sentence: error copy is UI text like any other
 * and lives in the locale files (`CLAUDE.md` §4).
 */
export type FieldErrors<T extends string> = Partial<Record<T, string>>

export type StudentField = keyof StudentDraft | 'minAge'
export type GuardianField = keyof GuardianDraft
export type PaymentField = keyof PaymentDraft

/**
 * The field rules themselves live in `@ooc/domain/fields` — the same copy
 * `apps/api` refuses with (OOC-64). What stays here is only what is the
 * browser's: the draft's shape, the phone split, the per-course minimum age.
 * Normalization (trim, folded spaces, lowercase e-mail, document without
 * separators) runs inside each field schema, so `12.345.678` passes here
 * exactly when it passes there.
 */

/**
 * Mobile number — the sheet's CELULAR column, stored as one string with the
 * dial code (`joinPhone`), the same as the backoffice.
 *
 * Emptiness is `splitPhone`, never `phone === ''`: the field starts life
 * holding `"+51"`, which is a dial code and not a phone.
 */
export function phoneNumberOf(phone: string): string {
  return splitPhone(phone).number.trim()
}

function nationalIdError(type: NationalIdType, raw: string): FieldErrorCode | null {
  return issueOf(NationalIdField, raw) ?? nationalIdIssue(type, normalizeNationalId(raw))
}

function setIf<T extends string>(errors: FieldErrors<T>, key: T, code: FieldErrorCode | null) {
  if (code) errors[key] = code
}

export function validateStudent(
  draft: StudentDraft,
  course: CatalogCourse | null,
  now = new Date(),
): FieldErrors<StudentField> {
  const errors: FieldErrors<StudentField> = {}

  setIf(errors, 'firstName', issueOf(PersonNameField, draft.firstName))
  setIf(errors, 'lastName', issueOf(PersonNameField, draft.lastName))
  setIf(errors, 'nationalId', nationalIdError(draft.nationalIdType, draft.nationalId))
  setIf(errors, 'phone', issueOf(PhoneField, phoneNumberOf(draft.phone)))

  const emailError = issueOf(EmailField, draft.email)
  if (emailError) errors.email = emailError
  // The address has to be a personal Gmail (`isGmail`) — Classroom.
  else if (!isGmail(draft.email)) errors.email = 'email_must_be_gmail'

  if (draft.birthDate === '') {
    errors.birthDate = 'required'
  } else {
    const age = ageFrom(draft.birthDate, now)
    if (!isPlausibleAge(age)) errors.birthDate = 'birth_date_range'
    // Minimum age is a gate, not a warning: a course with a floor of 13 does
    // not enroll a 10-year-old and sort it out later
    // (`docs/REGRAS-NEGOCIO.md` §2).
    else if (course && age < course.minAge) errors.minAge = 'min_age'
  }

  if (!draft.region) errors.region = 'required'
  setIf(errors, 'city', issueOf(CityField, draft.city))

  return errors
}

export function isMinor(birthDate: string, now = new Date()): boolean {
  if (birthDate === '') return false
  const age = ageFrom(birthDate, now)
  return age >= 0 && age < 18
}

/**
 * Guardian block, filled only for a minor. The consent is the point of it: Ley
 * 29733 wants the text version, the instant and the IP (`CLAUDE.md` §8), and
 * the last two are stamped by the server at submit — the browser records only
 * that the box was ticked.
 */
export function validateGuardian(draft: GuardianDraft): FieldErrors<GuardianField> {
  const errors: FieldErrors<GuardianField> = {}

  setIf(errors, 'firstName', issueOf(PersonNameField, draft.firstName))
  setIf(errors, 'lastName', issueOf(PersonNameField, draft.lastName))
  setIf(errors, 'nationalId', nationalIdError(draft.nationalIdType, draft.nationalId))
  setIf(errors, 'phone', issueOf(PhoneField, phoneNumberOf(draft.phone)))
  // Any provider: Classroom belongs to the student.
  const emailError = issueOf(EmailField, draft.email)
  if (emailError) errors.email = emailError
  // Typed twice, compared as the server will store it.
  else if (normalizeEmail(draft.emailConfirmation) !== normalizeEmail(draft.email)) {
    errors.emailConfirmation = 'email_mismatch'
  }

  if (!draft.consentAccepted) errors.consentAccepted = 'consent_required'

  return errors
}

export function validatePayment(draft: PaymentDraft): FieldErrors<PaymentField> {
  const errors: FieldErrors<PaymentField> = {}

  if (draft.method === null) errors.method = 'required'

  setIf(errors, 'operationNumber', issueOf(OperationNumberField, draft.operationNumber))

  // The hard one. Without the image there is nothing for the OCR ladder to
  // read (`CLAUDE.md` §5) and the enrollment is a line nobody can ever settle,
  // so it blocks the step rather than warning about it. A file the reader
  // attached but whose direct-to-bucket upload never confirmed (still
  // uploading, or failed) is the same as no file: `receiptUploadId` is what
  // the submit actually sends.
  if (draft.receipt === null || draft.receipt.receiptUploadId === null) {
    errors.receipt = 'receipt_required'
  }

  return errors
}

export function hasErrors(errors: Record<string, string | undefined>): boolean {
  return Object.keys(errors).length > 0
}

/* -------------------------------------------------------------------------- */
/* Empty draft                                                                */
/* -------------------------------------------------------------------------- */

export function emptyDraft(source: EnrollmentSource = 'web'): CheckoutDraft {
  return {
    course: {
      languageId: null,
      courseId: null,
      startDate: null,
      classGroupId: null,
    },
    student: {
      firstName: '',
      lastName: '',
      nationalIdType: 'DNI',
      nationalId: '',
      phone: '',
      email: '',
      birthDate: '',
      region: null,
      city: '',
    },
    guardian: {
      firstName: '',
      lastName: '',
      nationalIdType: 'DNI',
      nationalId: '',
      relationship: 'mother',
      phone: '',
      email: '',
      emailConfirmation: '',
      consentAccepted: false,
    },
    payment: { method: null, operationNumber: '', receipt: null },
    emailVerification: null,
    source,
    campaign: {},
  }
}
