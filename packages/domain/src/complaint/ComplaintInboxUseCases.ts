import { complaintAnsweredEmails } from "../notification/complaintEmails.js";
import type { IPlatformSettingsRepository } from "../platform/ports/IPlatformSettingsRepository.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { StudentNotFoundError } from "../student/errors.js";
import {
  COMPLAINT_STATUSES,
  MAX_COMPLAINT_ANSWER_LENGTH,
  complaintMatches,
  viewOfComplaint,
  type ComplaintListFilters,
  type ComplaintStatus,
  type ComplaintView,
  type IComplaintInboxRepository,
} from "./ComplaintInbox.js";
import {
  ComplaintAlreadyAnsweredError,
  ComplaintAlreadyTakenError,
  ComplaintAnswerRequiredError,
  ComplaintNotFoundError,
} from "./errors.js";

/**
 * The team's side of the complaints book (OOC-58): the inbox, one sheet,
 * taking it and answering it. Who may do which is the route's permission
 * (`complaints.view`, `complaints.answer`).
 */

export interface ComplaintInboxResult {
  items: ComplaintView[];
  /** Per status, and overdue, under the search — never under the status filter. */
  counts: Record<ComplaintStatus, number> & { overdue: number };
  responseBusinessDays: number;
}

/**
 * The book reads whole and filters in memory: a few sheets a week, and the
 * deadline — business days from the filing — is the domain's, not SQL's.
 */
export class ListComplaintsUseCase extends BaseUseCase<ComplaintListFilters, ComplaintInboxResult> {
  constructor(
    private readonly complaints: IComplaintInboxRepository,
    private readonly settings: IPlatformSettingsRepository,
  ) {
    super();
  }

  async run(filters: ComplaintListFilters): Promise<ComplaintInboxResult> {
    const { complaintResponseBusinessDays } = await this.settings.get();
    const now = new Date();
    const searched = (await this.complaints.list())
      .filter((record) => filters.search === null || complaintMatches(record, filters.search))
      .map((record) => viewOfComplaint(record, complaintResponseBusinessDays, now));

    const counts = Object.fromEntries(COMPLAINT_STATUSES.map((status) => [status, 0])) as ComplaintInboxResult["counts"];
    counts.overdue = 0;
    for (const view of searched) {
      counts[view.status] += 1;
      if (view.overdue) counts.overdue += 1;
    }

    const items = searched.filter(
      (view) => (filters.status === null || view.status === filters.status) && (!filters.overdue || view.overdue),
    );
    return { items, counts, responseBusinessDays: complaintResponseBusinessDays };
  }
}

/** What the panel's menu badge shows: sheets nobody took yet, and the overdue ones. */
export class ComplaintInboxSummaryUseCase extends BaseUseCase<void, { received: number; overdue: number }> {
  constructor(private readonly list: ListComplaintsUseCase) {
    super();
  }

  async run(): Promise<{ received: number; overdue: number }> {
    const { counts } = await this.list.run({ status: null, overdue: false, search: null });
    return { received: counts.received, overdue: counts.overdue };
  }
}

export class GetComplaintUseCase extends BaseUseCase<{ complaintId: string }, ComplaintView> {
  constructor(
    private readonly complaints: IComplaintInboxRepository,
    private readonly settings: IPlatformSettingsRepository,
  ) {
    super();
  }

  async run(input: { complaintId: string }): Promise<ComplaintView> {
    const record = await this.complaints.findById(input.complaintId);
    if (!record) throw new ComplaintNotFoundError();
    const { complaintResponseBusinessDays } = await this.settings.get();
    return viewOfComplaint(record, complaintResponseBusinessDays, new Date());
  }
}

/** The sheets of one student file — the block on the student's file. */
export class ListStudentComplaintsUseCase extends BaseUseCase<{ studentId: string }, ComplaintView[]> {
  constructor(
    private readonly complaints: IComplaintInboxRepository,
    private readonly settings: IPlatformSettingsRepository,
  ) {
    super();
  }

  async run(input: { studentId: string }): Promise<ComplaintView[]> {
    if (!(await this.complaints.studentExists(input.studentId))) throw new StudentNotFoundError();
    const { complaintResponseBusinessDays } = await this.settings.get();
    const now = new Date();
    return (await this.complaints.listForStudent(input.studentId)).map((record) =>
      viewOfComplaint(record, complaintResponseBusinessDays, now),
    );
  }
}

/**
 * Somebody takes the sheet — the inbox stops counting it as unread. Taking it
 * twice, or after it was answered, is refused: the steps are append-only.
 */
export class TakeComplaintUseCase extends BaseUseCase<{ complaintId: string; actorId: string }, void> {
  constructor(private readonly complaints: IComplaintInboxRepository) {
    super();
  }

  async run(input: { complaintId: string; actorId: string }): Promise<void> {
    const record = await this.complaints.findById(input.complaintId);
    if (!record) throw new ComplaintNotFoundError();
    if (record.answered) throw new ComplaintAlreadyAnsweredError();
    if (record.taken) throw new ComplaintAlreadyTakenError();
    await this.complaints.take(input);
  }
}

/**
 * The company's answer: written once, and e-mailed to the consumer in the
 * language of the form, in the same transaction. A sheet nobody took may be
 * answered directly.
 */
export class AnswerComplaintUseCase extends BaseUseCase<
  { complaintId: string; actorId: string; answer: string },
  void
> {
  constructor(private readonly complaints: IComplaintInboxRepository) {
    super();
  }

  async run(input: { complaintId: string; actorId: string; answer: string }): Promise<void> {
    const answer = input.answer.trim();
    if (answer.length === 0 || answer.length > MAX_COMPLAINT_ANSWER_LENGTH) throw new ComplaintAnswerRequiredError();
    const record = await this.complaints.findById(input.complaintId);
    if (!record) throw new ComplaintNotFoundError();
    if (record.answered) throw new ComplaintAlreadyAnsweredError();
    await this.complaints.answer({
      complaintId: record.id,
      actorId: input.actorId,
      answer,
      emails: complaintAnsweredEmails(record, answer),
    });
  }
}
