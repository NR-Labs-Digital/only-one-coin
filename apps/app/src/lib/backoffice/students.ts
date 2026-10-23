import { apiFetch } from './api-client'
import type { StudentActivityPage, StudentDetail, StudentRow } from './types'
import { studentDirectorySearchParams, type StudentDirectoryQuery } from './student-directory-query'

export {
  parseStudentDirectoryQuery,
  type StudentDirectoryQuery,
} from './student-directory-query'

/** One page of the student directory, as `GET /api/v1/students` answers it. */
export interface StudentDirectoryPage {
  items: StudentRow[]
  /** Students matching every filter, across every page. */
  total: number
  page: number
  pageSize: number
  /** Per tab and chip, over the search alone — what choosing each would give. */
  counts: { all: number; active: number; former: number; noEnrollment: number; minors: number }
}

/**
 * One page of the student directory (OOC-76). Search, status, age and paging
 * all run in Postgres — with 30k students a filter over the loaded page
 * answers the wrong question.
 *
 * `null` means the API failed (error response or unreachable) — the page
 * shows a visible error state for it. A silent empty page here is
 * indistinguishable from an empty directory, which reads as data loss.
 */
export async function listStudents(query: StudentDirectoryQuery): Promise<StudentDirectoryPage | null> {
  const search = studentDirectorySearchParams(query).toString()
  try {
    const response = await apiFetch(`/api/v1/students${search ? `?${search}` : ''}`)
    if (!response.ok) return null
    return response.json()
  } catch {
    return null
  }
}

/**
 * One student's file: identity, guardian and the full enrollment history
 * (OOC-73). `documents`, `documentRequests` and `attachments` come back empty
 * from the API itself (no table backs them yet, OOC-33), not faked here, so a
 * real id never mixes with unrelated mock fixture content.
 */
export async function getStudent(id: string): Promise<StudentDetail | null> {
  const response = await apiFetch(`/api/v1/students/${id}`)
  if (!response.ok) return null
  return response.json()
}

/**
 * The first page of a student's activity (OOC-75), newest first — later
 * pages are fetched by the file itself through the same-origin proxy. `null`
 * means the API failed: the tab says so instead of claiming nothing happened.
 */
export async function getStudentActivity(id: string): Promise<StudentActivityPage | null> {
  try {
    const response = await apiFetch(`/api/v1/students/${id}/activity`)
    if (!response.ok) return null
    return response.json()
  } catch {
    return null
  }
}
