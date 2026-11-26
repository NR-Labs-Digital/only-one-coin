import type { EmailNotification, Locale } from "../notification/EmailNotification.js";
import type { ComplaintGoodType, ComplaintKind, NationalIdType } from "../student/fields.js";
import type { ComplaintSupplier } from "./Complaint.js";

/**
 * The complaints book as the team reads it (OOC-58). A sheet is append-only
 * (OOC-63); what the company did with it is a step of its own, each once:
 * somebody took it, somebody answered it. The status is read from the steps,
 * never stored — no step is `received`.
 */
export const COMPLAINT_STATUSES = ["received", "in_progress", "answered"] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

/** The longest answer the team may send — the CHECK of `complaint_events` (0079). */
export const MAX_COMPLAINT_ANSWER_LENGTH = 5000;

export interface ComplaintStep {
  at: Date;
  /** The person's name from the account; null when the account is gone. */
  actorName: string | null;
}

/** The student file a sheet points to: same document, compared normalized. */
export interface ComplaintStudentLink {
  studentId: string;
  fullName: string;
}

/** A sheet with its steps, as the repository reads it. */
export interface ComplaintRecord {
  id: string;
  code: string;
  kind: ComplaintKind;
  filedAt: Date;
  supplier: ComplaintSupplier;
  consumer: {
    firstName: string;
    lastName: string;
    secondLastName: string | null;
    nationalIdType: NationalIdType;
    nationalId: string;
    phone: string;
    email: string;
    department: string;
    province: string;
    district: string;
    address: string;
    addressReference: string | null;
    isMinor: boolean;
  };
  guardian: {
    firstName: string;
    lastName: string;
    nationalIdType: NationalIdType;
    nationalId: string;
  } | null;
  goodType: ComplaintGoodType;
  amountCents: number | null;
  /** Calendar day, `YYYY-MM-DD`. */
  purchasedOn: string | null;
  description: string;
  detail: string;
  request: string;
  /** The language of the form — the copy went out in it, and so does the answer. */
  locale: Locale;
  taken: ComplaintStep | null;
  answered: (ComplaintStep & { answer: string }) | null;
  /**
   * Null when no student file has the consumer's document: a complaint does
   * not depend on being a student, and the guardian of a minor, or somebody
   * who never enrolled, files too.
   */
  student: ComplaintStudentLink | null;
}

/** A sheet with what its clock says today. */
export interface ComplaintView extends ComplaintRecord {
  status: ComplaintStatus;
  /** The last day to answer, a calendar day in Lima (`YYYY-MM-DD`). */
  dueOn: string;
  /** The end of `dueOn` in Lima. */
  deadlineAt: Date;
  /** Not answered and past the deadline. */
  overdue: boolean;
  /** Answered after the deadline. */
  answeredLate: boolean;
  /**
   * Business days from today (Lima) up to and including `dueOn`; 0 on the
   * last day itself and on any day after it. Meaningless once answered.
   */
  businessDaysLeft: number;
}

export interface ComplaintListFilters {
  status: ComplaintStatus | null;
  overdue: boolean;
  /** Code, consumer name or document — matched loosely. */
  search: string | null;
}

export interface IComplaintInboxRepository {
  /** Every sheet of the book, newest first. */
  list(): Promise<ComplaintRecord[]>;
  findById(id: string): Promise<ComplaintRecord | null>;
  /** The sheets whose consumer document is this student file's. */
  listForStudent(studentId: string): Promise<ComplaintRecord[]>;
  studentExists(studentId: string): Promise<boolean>;
  /**
   * The `taken` step and its audit entry, in one transaction. The unique
   * index decides two people taking at once: the second is
   * `ComplaintAlreadyTakenError`.
   */
  take(params: { complaintId: string; actorId: string }): Promise<void>;
  /**
   * The `answered` step, the e-mail to the consumer and the audit entry, in
   * one transaction. A second answer is `ComplaintAlreadyAnsweredError`.
   */
  answer(params: {
    complaintId: string;
    actorId: string;
    answer: string;
    emails: EmailNotification[];
  }): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

// Lima has no daylight saving: UTC-5 all year.
const LIMA_OFFSET_MS = 5 * 3_600_000;
const DAY_MS = 86_400_000;

function limaDay(instant: Date): number {
  const lima = new Date(instant.getTime() - LIMA_OFFSET_MS);
  return Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), lima.getUTCDate());
}

const isBusinessDay = (day: number) => {
  const weekday = new Date(day).getUTCDay();
  return weekday !== 0 && weekday !== 6;
};

const isoDay = (day: number) => new Date(day).toISOString().slice(0, 10);

/**
 * The last day to answer: `businessDays` business days after the day the
 * sheet was filed in Lima — the first one is the next business day. Monday
 * to Friday; there is no holiday calendar yet (the same gap as the
 * certificate's deadline), so a holiday counts as a working day.
 */
export function complaintDueOn(filedAt: Date, businessDays: number): string {
  let day = limaDay(filedAt);
  let left = businessDays;
  while (left > 0) {
    day += DAY_MS;
    if (isBusinessDay(day)) left -= 1;
  }
  return isoDay(day);
}

/** The end of a calendar day in Lima, as an instant. */
export function endOfLimaDay(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1) + LIMA_OFFSET_MS);
}

/** Business days from the day after `now` (Lima) up to and including `dueOn`. */
export function businessDaysUntil(dueOn: string, now: Date): number {
  const due = endOfLimaDay(dueOn).getTime() - DAY_MS - LIMA_OFFSET_MS;
  let day = limaDay(now);
  let count = 0;
  while (day < due) {
    day += DAY_MS;
    if (isBusinessDay(day)) count += 1;
  }
  return count;
}

export function complaintStatusOf(record: Pick<ComplaintRecord, "taken" | "answered">): ComplaintStatus {
  if (record.answered) return "answered";
  if (record.taken) return "in_progress";
  return "received";
}

export function viewOfComplaint(record: ComplaintRecord, businessDays: number, now: Date): ComplaintView {
  const dueOn = complaintDueOn(record.filedAt, businessDays);
  const deadlineAt = endOfLimaDay(dueOn);
  const status = complaintStatusOf(record);
  return {
    ...record,
    status,
    dueOn,
    deadlineAt,
    overdue: status !== "answered" && now.getTime() >= deadlineAt.getTime(),
    answeredLate: record.answered !== null && record.answered.at.getTime() >= deadlineAt.getTime(),
    businessDaysLeft: businessDaysUntil(dueOn, now),
  };
}

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s.\-]+/g, " ")
    .trim();

/** Whether a sheet answers the inbox's search box: its number, the consumer's name or document. */
export function complaintMatches(record: ComplaintRecord, search: string): boolean {
  const needle = fold(search);
  if (needle === "") return true;
  const consumer = record.consumer;
  const haystack = fold(
    [record.code, consumer.firstName, consumer.lastName, consumer.secondLastName ?? "", consumer.nationalId].join(" "),
  );
  return haystack.includes(needle) || fold(consumer.nationalId).replace(/ /g, "") === needle.replace(/ /g, "");
}
