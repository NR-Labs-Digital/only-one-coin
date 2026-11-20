import type { EnrollmentStatus } from '@/lib/backoffice/types'

/**
 * Who a manual send could reach — the options of the segment picker and the
 * count each one resolves to.
 *
 * The campaign screen stays a mockup until Fase 5 (`docs/ROADMAP.md`, OOC-42):
 * no route resolves a segment yet, so every list is empty and every count is
 * zero. That is the honest answer — the picker never offers a course or a
 * class group, nor a number of people, that nobody read from the register.
 * It lives here, beside the one screen that reads it, since the backoffice
 * mock dataset is gone (OOC-92); when the segment query exists, this file is
 * what it replaces.
 */
export interface CampaignAudience {
  allCount: number
  courses: { name: string; count: number }[]
  classGroups: { id: string; label: string; count: number }[]
  statuses: { status: EnrollmentStatus; count: number }[]
}

const STATUSES: EnrollmentStatus[] = ['under_review', 'active', 'completed', 'rejected']

export function campaignAudience(): CampaignAudience {
  return {
    allCount: 0,
    courses: [],
    classGroups: [],
    statuses: STATUSES.map((status) => ({ status, count: 0 })),
  }
}
