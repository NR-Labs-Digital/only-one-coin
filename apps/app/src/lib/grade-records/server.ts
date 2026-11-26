import { apiFetch } from '@/lib/backoffice/api-client'
import type { GradeRecordRow } from './types'

/**
 * The actas de notas (OOC-176), read on the server. Null means the read
 * failed — never an empty list that would read as "no acta yet".
 */

export async function listGradeRecords(filters: {
  period?: string
  teacher?: string
}): Promise<GradeRecordRow[] | null> {
  const query = new URLSearchParams()
  if (filters.period) query.set('period', filters.period)
  if (filters.teacher) query.set('teacher', filters.teacher)
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  try {
    const response = await apiFetch(`/api/v1/grade-register-records${suffix}`)
    if (!response.ok) return null
    return ((await response.json()) as { items: GradeRecordRow[] }).items
  } catch {
    return null
  }
}

/** The signed-in teacher's own actas, scoped by the session in the API. */
export async function listOwnGradeRecords(): Promise<GradeRecordRow[] | null> {
  try {
    const response = await apiFetch('/api/v1/teaching/grade-register-records')
    if (!response.ok) return null
    return ((await response.json()) as { items: GradeRecordRow[] }).items
  } catch {
    return null
  }
}
