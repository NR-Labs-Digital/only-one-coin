import type { EmailNotification } from "../notification/EmailNotification.js";
import type { FiledComplaint, NewComplaint } from "./Complaint.js";

export interface IComplaintRepository {
  /**
   * Writes the sheet and its e-mails in one transaction. The number is drawn
   * by the database. A sheet already filed with the same idempotency key is
   * returned as it is, and nothing is written again.
   */
  /** The sheet already filed under this idempotency key, if any. */
  findByIdempotencyKey(idempotencyKey: string): Promise<FiledComplaint | null>;
  file(complaint: NewComplaint, emails: (filed: FiledComplaint) => EmailNotification[]): Promise<FiledComplaint>;
}
