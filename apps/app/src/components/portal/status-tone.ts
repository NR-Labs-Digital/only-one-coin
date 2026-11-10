import type { Tone } from './ui'
import type {
  EnrollmentStatus,
  ModuleStatus,
  PaymentStatus,
  RequestStatus,
  SeatStatus,
} from '@/lib/portal/types'

/** Maps domain enums to a visual tone. No UI copy here — labels come from i18n. */

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

export const requestTone: Record<RequestStatus, Tone> = {
  under_review: 'warning',
  in_progress: 'info',
  completed: 'success',
  rejected: 'danger',
}

export const moduleTone: Record<ModuleStatus, Tone> = {
  completed: 'success',
  current: 'info',
  upcoming: 'neutral',
}
