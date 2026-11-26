import { apiFetch } from './api-client'

/**
 * The complaints book's inbox (OOC-58), read on the server from apps/api
 * (`complaints.view`). Null means the read failed — never an empty list that
 * would read as "no complaint filed".
 */

export const COMPLAINT_STATUSES = ['received', 'in_progress', 'answered'] as const
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number]

export type ComplaintKind = 'claim' | 'grievance'
export type ComplaintGoodType = 'product' | 'service'
export type ComplaintIdType = 'DNI' | 'CE' | 'passport'

export interface ComplaintStep {
  at: string
  byName: string | null
}

export interface ComplaintRow {
  id: string
  code: string
  kind: ComplaintKind
  goodType: ComplaintGoodType
  filedAt: string
  consumerName: string
  consumerNationalIdType: ComplaintIdType
  consumerNationalId: string
  consumerIsMinor: boolean
  status: ComplaintStatus
  /** The last day to answer, `YYYY-MM-DD` in Lima. */
  dueOn: string
  deadlineAt: string
  overdue: boolean
  answeredLate: boolean
  businessDaysLeft: number
  taken: ComplaintStep | null
  answered: ComplaintStep | null
  student: { studentId: string; fullName: string } | null
}

export interface ComplaintDetail extends ComplaintRow {
  supplier: { legalName: string; ruc: string; address: string }
  consumer: {
    firstName: string
    lastName: string
    secondLastName: string | null
    nationalIdType: ComplaintIdType
    nationalId: string
    phone: string
    email: string
    department: string
    province: string
    district: string
    address: string
    addressReference: string | null
    isMinor: boolean
  }
  guardian: { firstName: string; lastName: string; nationalIdType: ComplaintIdType; nationalId: string } | null
  amountCents: number | null
  purchasedOn: string | null
  description: string
  detail: string
  request: string
  locale: 'es-PE' | 'pt-BR' | 'en'
  answer: string | null
}

export interface ComplaintInbox {
  items: ComplaintRow[]
  counts: Record<ComplaintStatus, number> & { overdue: number }
  responseBusinessDays: number
}

export async function listComplaints(filters: {
  status?: ComplaintStatus
  overdue?: boolean
  q?: string
}): Promise<ComplaintInbox | null> {
  const query = new URLSearchParams()
  if (filters.status) query.set('status', filters.status)
  if (filters.overdue) query.set('overdue', 'true')
  if (filters.q) query.set('q', filters.q)
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  try {
    const response = await apiFetch(`/api/v1/complaints${suffix}`)
    if (!response.ok) return null
    return (await response.json()) as ComplaintInbox
  } catch {
    return null
  }
}

/** The menu's badge. A failed read is null: no badge beats a wrong zero. */
export async function getComplaintSummary(): Promise<{ received: number; overdue: number } | null> {
  try {
    const response = await apiFetch('/api/v1/complaints/summary')
    if (!response.ok) return null
    return (await response.json()) as { received: number; overdue: number }
  } catch {
    return null
  }
}

/** One sheet; `not_found` is the 404, kept apart from a failed read. */
export async function getComplaint(id: string): Promise<ComplaintDetail | 'not_found' | null> {
  try {
    const response = await apiFetch(`/api/v1/complaints/${encodeURIComponent(id)}`)
    if (response.status === 404 || response.status === 400) return 'not_found'
    if (!response.ok) return null
    return (await response.json()) as ComplaintDetail
  } catch {
    return null
  }
}

/** The sheets of one student file, by the consumer's document. */
export async function listStudentComplaints(studentId: string): Promise<ComplaintRow[] | null> {
  try {
    const response = await apiFetch(`/api/v1/students/${encodeURIComponent(studentId)}/complaints`)
    if (!response.ok) return null
    return ((await response.json()) as { items: ComplaintRow[] }).items
  } catch {
    return null
  }
}
