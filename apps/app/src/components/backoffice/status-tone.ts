import type { Tone } from './ui'
import type {
  AuditAction,
  CertificationExamStatus,
  ClassGroupStatus,
  DocumentStatus,
  EmailDeliveryStatus,
  GradeStatus,
  EnrollmentStatus,
  PaymentStatus,
  ReceiptFraudSignalKind,
  ReceiptVerdict,
  ReviewReceiptState,
  SeatStatus,
  StudentStatus,
  TeacherStatus,
} from '@/lib/backoffice/types'

/** Maps domain enums to a visual tone. No UI copy here — labels come from i18n. */

export const studentTone: Record<StudentStatus, Tone> = {
  active: 'success',
  former: 'info',
  under_review: 'warning',
  no_enrollment: 'neutral',
}

/** Off the roster is not an alarm — it is a record kept on purpose. */
export const teacherTone: Record<TeacherStatus, Tone> = {
  active: 'success',
  inactive: 'neutral',
}

export const enrollmentTone: Record<EnrollmentStatus, Tone> = {
  under_review: 'warning',
  active: 'success',
  frozen: 'info',
  completed: 'neutral',
  rejected: 'danger',
}

export const paymentTone: Record<PaymentStatus, Tone> = {
  pending: 'neutral',
  under_review: 'warning',
  approved: 'success',
  rejected: 'danger',
}

export const seatTone: Record<SeatStatus, Tone> = {
  reserved: 'warning',
  confirmed: 'success',
  released: 'neutral',
}

export const documentTone: Record<DocumentStatus, Tone> = {
  available: 'success',
  pending: 'warning',
  locked: 'neutral',
}

/** The receipt traffic light (OOC-21) in its own colours. Green still waits
 *  for a person — it only says amount, number and method match. */
export const verdictTone: Record<ReceiptVerdict, Tone> = {
  approve: 'success',
  review: 'warning',
  reject_suggested: 'danger',
}

/**
 * Where an open payment's receipt stands. No receipt at all is the one that
 * needs attention: approving it rests on the bank statement alone.
 */
export const receiptStateTone: Record<ReviewReceiptState, Tone> = {
  missing: 'warning',
  uploading: 'info',
  ready: 'success',
  refused: 'danger',
}

/** The same file already used is a hard stop; the rest are reasons to look twice. */
export const fraudSignalTone: Record<ReceiptFraudSignalKind, Tone> = {
  identical_file: 'danger',
  similar_image: 'warning',
  edited_with_software: 'warning',
  modified_after_capture: 'warning',
  payer_name_mismatch: 'warning',
}

export const auditTone: Record<AuditAction, Tone> = {
  student_registered: 'info',
  student_updated: 'info',
  guardian_added: 'info',
  guardian_updated: 'info',
  enrollment_created: 'info',
  payment_approved: 'success',
  payment_rejected: 'danger',
  receipt_viewed: 'neutral',
}

/** Outbox state of the e-mail that carries a document (CLAUDE.md §5). */
export const deliveryTone: Record<EmailDeliveryStatus, Tone> = {
  not_sent: 'neutral',
  queued: 'info',
  sent: 'success',
  failed: 'danger',
}

export const classGroupTone: Record<ClassGroupStatus, Tone> = {
  // Not on sale yet: nothing to act on, nothing wrong.
  draft: 'neutral',
  enrolling: 'info',
  in_progress: 'success',
  // Finished still owes certificates — it must not read as "done".
  finished: 'warning',
  closed: 'neutral',
}

/** `auto_failed` is the DA — a missed final exam, not a low grade. */
export const gradeTone: Record<GradeStatus, Tone> = {
  approved: 'success',
  failed: 'danger',
  auto_failed: 'danger',
  pending: 'neutral',
}

export const examTone: Record<CertificationExamStatus, Tone> = {
  approved: 'success',
  failed: 'danger',
  pending: 'warning',
  not_requested: 'neutral',
}

/** Seat pressure: full → danger, ≥85% → warning. */
export function seatPressureTone(taken: number, capacity: number): Tone {
  if (capacity === 0) return 'neutral'
  const pct = (taken / capacity) * 100
  if (pct >= 100) return 'danger'
  if (pct >= 85) return 'warning'
  return 'info'
}
