import { apiFetch } from './api-client'
import type { GradeRegister, GradeRegisterStatus } from '@/lib/docente/teaching'
import type { WeeklySlotItem } from './types'

/**
 * Coordination's reads of the grade registers (OOC-180, `GRADE_READ_ROLES`):
 * a class group's registers, and the list of registers pending review and out
 * of time across class groups (the screen OOC-170 asked for). Null means the
 * read failed — never an empty list that would read as "nothing pending".
 */

export type { GradeRegister, GradeRegisterStatus }

export async function getClassGroupGradeRegisters(classGroupId: string): Promise<GradeRegister[] | null> {
  try {
    const response = await apiFetch(
      `/api/v1/catalog/class-groups/${encodeURIComponent(classGroupId)}/grade-registers`,
    )
    if (!response.ok) return null
    return ((await response.json()) as { items: GradeRegister[] }).items
  } catch {
    return null
  }
}

/** One row of the list: the register and the class group, course, run and teacher it is of. */
export interface GradeRegisterRow extends GradeRegister {
  classGroupCode: string
  classGroupStatus: string
  courseName: string
  academicPeriodId: string
  academicPeriodName: string
  module: number | null
  slots: WeeklySlotItem[]
  teacherId: string | null
  teacherName: string | null
}

export interface GradeRegisterFilters {
  period?: string
  teacher?: string
  module?: number
  status?: GradeRegisterStatus
  overdue?: boolean
}

export async function listGradeRegisters(
  filters: GradeRegisterFilters,
): Promise<{ items: GradeRegisterRow[]; submissionHours: number } | null> {
  const query = new URLSearchParams()
  if (filters.period) query.set('period', filters.period)
  if (filters.teacher) query.set('teacher', filters.teacher)
  if (filters.module) query.set('module', String(filters.module))
  if (filters.status) query.set('status', filters.status)
  if (filters.overdue) query.set('overdue', 'true')
  try {
    const response = await apiFetch(`/api/v1/grade-registers?${query.toString()}`)
    if (!response.ok) return null
    return (await response.json()) as {
      items: GradeRegisterRow[]
      submissionHours: number
    }
  } catch {
    return null
  }
}
