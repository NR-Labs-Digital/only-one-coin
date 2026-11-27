import type { EnrollmentEmailContext } from "../enrollment/EnrollmentEmailContextLookup.js";
import type { EmailNotification, Locale } from "../notification/EmailNotification.js";
import { enrollmentRecipients } from "../notification/enrollmentEmails.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";

/**
 * The renewal e-mail (OOC-53, decisions of 27/11/2026 with Miguel — to be
 * confirmed with the owner): seven days before the class group ends, an
 * invitation to keep studying. Generic on purpose — the catalog has no "next
 * course" of a course, and naming one would be a rule nobody wrote.
 *
 * "The end" is the class group's `ends_on`, a Lima calendar day; the e-mail
 * leaves from 09:00 Lima of the day seven days before it. A day missed (the
 * worker was down all of it) is not sent late: an e-mail about "seven days"
 * that arrives with three left says the wrong thing.
 */
export const RENEWAL_DAYS_BEFORE_END = 7;
export const RENEWAL_SEND_FROM_HOUR = 9;

const LIMA = "America/Lima";

/** The Lima calendar day (YYYY-MM-DD) and hour (0–23) of an instant. */
export function limaDayAndHour(now: Date): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LIMA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return { day: `${part("year")}-${part("month")}-${part("day")}`, hour: Number(part("hour")) };
}

/**
 * The class group end day whose enrollments are due at this instant, or null
 * before 09:00 Lima. Lima has no daylight saving, so a calendar day is always
 * 24 hours and adding days in UTC never slips.
 */
export function renewalEndDayDueAt(now: Date): string | null {
  const { day, hour } = limaDayAndHour(now);
  if (hour < RENEWAL_SEND_FROM_HOUR) return null;
  const end = new Date(`${day}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + RENEWAL_DAYS_BEFORE_END);
  return end.toISOString().slice(0, 10);
}

export function courseEndingRenewalEmails(
  facts: EnrollmentEmailContext & { enrollmentId: string; endsOnDay: string; endsOn: Date },
  locale: Locale,
): EmailNotification[] {
  const studentName = `${facts.student.firstName} ${facts.student.lastName}`;
  return enrollmentRecipients(facts).map((recipient) => ({
    templateKey: "course_ending_renewal",
    to: recipient.to,
    locale,
    vars: {
      recipientName: recipient.name,
      studentName,
      courseName: facts.courseName,
      endsOn: facts.endsOn.toISOString(),
    },
    // One per enrollment, end day and recipient: a tick that runs twice
    // writes once, and an end date moved later earns its own e-mail.
    dedupeKey: `course_ending_renewal:${facts.enrollmentId}:${facts.endsOnDay}:${recipient.kind}`,
  }));
}

/** A confirmed enrollment whose class group ends on the day asked for. */
export interface EndingEnrollment {
  enrollmentId: string;
  studentId: string;
  classGroupId: string;
  endsOn: Date;
}

export interface ICourseEndingRenewalRepository {
  /**
   * Live enrollments with a confirmed seat (frozen, reserved and released
   * are out) in a live, enrolling or in-progress class group whose `ends_on`
   * falls on this Lima day.
   */
  listEndingOn(endsOnDay: string): Promise<EndingEnrollment[]>;
  findEmailContext(params: { studentId: string; classGroupId: string }): Promise<EnrollmentEmailContext | null>;
  /** ON CONFLICT on the dedupe key: an e-mail already written is a no-op. Answers how many were new. */
  queue(emails: EmailNotification[]): Promise<number>;
}

export class SendCourseEndingRenewalUseCase extends BaseUseCase<{ locale: Locale; now: Date }, { queued: number }> {
  constructor(private readonly repository: ICourseEndingRenewalRepository) {
    super();
  }

  async run(input: { locale: Locale; now: Date }): Promise<{ queued: number }> {
    const endsOnDay = renewalEndDayDueAt(input.now);
    if (endsOnDay === null) return { queued: 0 };
    const emails: EmailNotification[] = [];
    for (const ending of await this.repository.listEndingOn(endsOnDay)) {
      const context = await this.repository.findEmailContext({ studentId: ending.studentId, classGroupId: ending.classGroupId });
      if (!context) continue;
      emails.push(
        ...courseEndingRenewalEmails({ ...context, enrollmentId: ending.enrollmentId, endsOnDay, endsOn: ending.endsOn }, input.locale),
      );
    }
    return { queued: emails.length === 0 ? 0 : await this.repository.queue(emails) };
  }
}
