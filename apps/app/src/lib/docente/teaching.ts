import { cache } from 'react'
import { apiFetch } from '@/lib/backoffice/api-client'
import { toLanguage } from '@/lib/backoffice/teachers'
import type { ClassGroupStatus, CourseLanguage, WeeklySlotItem } from '@/lib/backoffice/types'

/**
 * The docente portal's reads (OOC-82), `apps/api` `/teaching/*`. Every one is
 * scoped by the session on the API side — the usecase compares the teacher
 * behind the account with the class group (CLAUDE.md §8). Nothing here sends
 * a teacher id: there is none to send, and one sent would not be trusted.
 *
 * `null` means the API failed, so the screen says it could not load — an
 * empty portal and "could not load" are different facts.
 */

/** A class group as the teacher reads it: no money, no waitlist, no coordination. */
export interface TeachingClassGroup {
  id: string
  /** Catalog data, allowed on screen (CLAUDE.md §4). */
  code: string
  courseName: string
  language: CourseLanguage
  academicPeriodName: string
  slots: WeeklySlotItem[]
  /** ISO 8601 UTC, rendered in America/Lima. */
  startsOn: string | null
  endsOn: string | null
  capacity: number
  seatsTaken: number
  status: ClassGroupStatus
  /** The Google Classroom coordination pasted with the teacher (OOC-98); null = not yet. */
  classroomUrl: string | null
  /** Which of the course's modules it teaches (OOC-100); null = coordination has not set it. */
  module: number | null
  /** That module's material, from the course (OOC-100); null = nothing to open. */
  moduleMaterialUrl: string | null
  /** Teaches every module of the course (OOC-130); `module` is null then. */
  fullCourse: boolean
  /** Every module's material, in order, on a full-course class group; empty on any other. */
  courseMaterialUrls: string[]
}

/** One student of the class group — the name, never the document or the contact. */
export interface TeachingStudent {
  enrollmentId: string
  studentName: string
}

export interface TeachingSummary {
  /** Class groups enrolling or running. */
  teaching: number
  /** Every class group in the portal, finished ones included. */
  inPortal: number
  /** Confirmed students across the ones teaching. */
  students: number
}

type ApiClassGroup = Omit<TeachingClassGroup, 'language'> & { language: string }

function toClassGroup(row: ApiClassGroup): TeachingClassGroup {
  return { ...row, language: toLanguage(row.language) }
}

/** The signed-in teacher's class groups still in the portal. */
export const listOwnClassGroups = cache(async (): Promise<TeachingClassGroup[] | null> => {
  try {
    const response = await apiFetch('/api/v1/teaching/class-groups')
    if (!response.ok) return null
    const { items } = (await response.json()) as { items: ApiClassGroup[] }
    return items.map(toClassGroup)
  } catch {
    return null
  }
})

/**
 * One of the signed-in teacher's class groups. `'not_found'` covers somebody
 * else's and one that does not exist alike — the API does not tell them apart,
 * and neither does the page.
 */
export const getOwnClassGroup = cache(
  async (id: string): Promise<TeachingClassGroup | 'not_found' | null> => {
    try {
      const response = await apiFetch(`/api/v1/teaching/class-groups/${encodeURIComponent(id)}`)
      if (response.status === 404 || response.status === 400) return 'not_found'
      if (!response.ok) return null
      return toClassGroup((await response.json()) as ApiClassGroup)
    } catch {
      return null
    }
  },
)

/** Who is in one of the teacher's class groups, surname order. */
export const listOwnClassGroupStudents = cache(
  async (id: string): Promise<TeachingStudent[] | null> => {
    try {
      const response = await apiFetch(
        `/api/v1/teaching/class-groups/${encodeURIComponent(id)}/students`,
      )
      if (!response.ok) return null
      const { items } = (await response.json()) as { items: TeachingStudent[] }
      return items
    } catch {
      return null
    }
  },
)

/**
 * One final grade as it counts (OOC-38): the exam's, or DA in its place. Final
 * for the teacher; only the academic supervision corrects it (OOC-102).
 */
export interface TeachingGrade {
  enrollmentId: string
  /** 0–20, decimals allowed; null on a DA. */
  grade: number | null
  didNotSit: boolean
  /** ISO 8601 UTC. */
  recordedAt: string
  /** When the academic supervision last corrected it (OOC-102); null = as posted. */
  correctedAt: string | null
}

/** The grades posted in one of the teacher's class groups; null when the read failed. */
export const listOwnClassGroupGrades = cache(
  async (id: string): Promise<TeachingGrade[] | null> => {
    try {
      const response = await apiFetch(
        `/api/v1/teaching/class-groups/${encodeURIComponent(id)}/grades`,
      )
      if (!response.ok) return null
      const { items } = (await response.json()) as { items: TeachingGrade[] }
      return items
    } catch {
      return null
    }
  },
)

export const getTeachingSummary = cache(async (): Promise<TeachingSummary | null> => {
  try {
    const response = await apiFetch('/api/v1/teaching/summary')
    if (!response.ok) return null
    return (await response.json()) as TeachingSummary
  } catch {
    return null
  }
})

/** Enrolling or running — the teacher's load right now, the API's `teaching`. */
export function isTeaching(group: Pick<TeachingClassGroup, 'status'>): boolean {
  return group.status === 'enrolling' || group.status === 'in_progress'
}
