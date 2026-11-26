import type { ComplaintStatus } from '@/lib/backoffice/complaints'
import type { Tone } from './ui'

/** The colour of a complaints book sheet's status (OOC-58): waiting is the warning. */
export const complaintTone: Record<ComplaintStatus, Tone> = {
  received: 'warning',
  in_progress: 'info',
  answered: 'success',
}
