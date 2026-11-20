import type { EnrollmentEmailContext } from "../enrollment/EnrollmentEmailContextLookup.js";
import type { EmailNotification, Locale } from "../notification/EmailNotification.js";
import { enrollmentRecipients } from "../notification/enrollmentEmails.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";

/**
 * The re-engagement of a frozen enrollment (CLAUDE.md §1, decision of
 * 02/09/2026): an e-mail 1, 3 and 6 months after the freeze — the one at 6 is
 * the last; after it, silence, never removal. A milestone missed (the worker
 * was down) is not sent late: only the latest one reached is, once.
 */
export const FREEZE_REENGAGEMENT_MONTHS = [1, 3, 6] as const;
export type FreezeReengagementMonths = (typeof FREEZE_REENGAGEMENT_MONTHS)[number];

/** The latest milestone a freeze of this age reached, or null before the first. */
export function reengagementMilestone(monthsFrozen: number): FreezeReengagementMonths | null {
  let reached: FreezeReengagementMonths | null = null;
  for (const months of FREEZE_REENGAGEMENT_MONTHS) if (monthsFrozen >= months) reached = months;
  return reached;
}

export function freezeReengagementEmails(
  facts: EnrollmentEmailContext & { freezeId: string; months: FreezeReengagementMonths },
  locale: Locale,
): EmailNotification[] {
  const studentName = `${facts.student.firstName} ${facts.student.lastName}`;
  return enrollmentRecipients(facts).map((recipient) => ({
    templateKey: "enrollment_freeze_reengagement",
    to: recipient.to,
    locale,
    vars: { recipientName: recipient.name, studentName, courseName: facts.courseName, months: facts.months },
    // One per freeze, milestone and recipient: a tick that runs twice writes once.
    dedupeKey: `enrollment_freeze_reengagement:${facts.freezeId}:${facts.months}:${recipient.kind}`,
  }));
}

/** A live freeze and how many whole months it has been frozen (Lima calendar is the repository's). */
export interface FrozenForReengagement {
  freezeId: string;
  studentId: string;
  classGroupId: string;
  monthsFrozen: number;
}

export interface IFreezeReengagementRepository {
  /** Live freezes (still frozen, not returned) at least one month old. */
  listLiveFreezes(): Promise<FrozenForReengagement[]>;
  findEmailContext(params: { studentId: string; classGroupId: string }): Promise<EnrollmentEmailContext | null>;
  /** ON CONFLICT on the dedupe key: an e-mail already written is a no-op. Answers how many were new. */
  queue(emails: EmailNotification[]): Promise<number>;
}

export class SendFreezeReengagementUseCase extends BaseUseCase<{ locale: Locale }, { queued: number }> {
  constructor(private readonly repository: IFreezeReengagementRepository) {
    super();
  }

  async run(input: { locale: Locale }): Promise<{ queued: number }> {
    const emails: EmailNotification[] = [];
    for (const freeze of await this.repository.listLiveFreezes()) {
      const months = reengagementMilestone(freeze.monthsFrozen);
      if (months === null) continue;
      const context = await this.repository.findEmailContext({ studentId: freeze.studentId, classGroupId: freeze.classGroupId });
      if (!context) continue;
      emails.push(...freezeReengagementEmails({ ...context, freezeId: freeze.freezeId, months }, input.locale));
    }
    return { queued: emails.length === 0 ? 0 : await this.repository.queue(emails) };
  }
}
