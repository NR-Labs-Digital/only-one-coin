export type ReceiptUploadStatus = "pending" | "uploaded" | "processing" | "processed" | "rejected";

/**
 * File custody for a checkout receipt photo, scoped to the seat hold rather
 * than the payment — at the point the checkout uploads a photo, the hold is
 * the only server-minted id that exists (OOC-19; the enrollment and payment
 * are only born at submit, apps/api/CLAUDE.md "Upload"). `paymentId` fills in
 * the same way `SeatHold`'s consumption does: null while the checkout is
 * still being filled in, set once inside the submit transaction.
 *
 * A read shape, not an entity with behaviour, same reasoning as `SeatHold`:
 * every transition (confirm, normalize, reject, link to a payment) happens
 * inside a repository statement guarded on the row's current status, never
 * decided from a copy held in memory.
 */
export interface ReceiptUpload {
  id: string;
  /** Exactly one of these two (`receipt_uploads_owner_check`): the checkout's
   * hold, or the procedure request of a signed-in student (OOC-83). */
  seatHoldId: string | null;
  procedureRequestId: string | null;
  paymentId: string | null;
  objectKey: string;
  status: ReceiptUploadStatus;
  processedObjectKey: string | null;
}
