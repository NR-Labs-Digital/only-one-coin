import { apiFetch } from './api-client'
import type { StudentDetail, StudentRow } from './types'

export interface StudentListPage {
  items: StudentRow[]
  /** Non-null when another page of the directory browse follows — pass it
   * straight back as `?cursor=` to fetch the next page. Always null for a
   * `q` search (a short, non-paginated match list). */
  nextCursor: string | null
  /** Live students in total (directory browse only; null for a `q` search) —
   * what lets the table offer pages it has not fetched yet. */
  total: number | null
}

/**
 * The student directory (no `q`) and, elsewhere, the manual enrollment
 * form's picker (`q` set) — same `GET /api/v1/students` route, which
 * merges both concerns off one query (`apps/api/src/infra/persistence/
 * student/ListStudentsQuery.ts`).
 *
 * The directory browse is cursor-paginated server-side — this only fetches
 * one page. The client component (`students-table.tsx`) calls the
 * same-origin `/api/v1/students` proxy directly for subsequent pages, since
 * this function runs in a Server Component and can't be called again from
 * the browser.
 *
 * `null` means the API failed (error response or unreachable) — the page
 * shows a visible error state for it. A silent empty page here is
 * indistinguishable from an empty directory, which reads as data loss.
 */
export async function listStudents(cursor?: string): Promise<StudentListPage | null> {
  const search = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  try {
    const response = await apiFetch(`/api/v1/students${search}`)
    if (!response.ok) return null
    return response.json()
  } catch {
    return null
  }
}

/**
 * One student's file. Only the identity/guardian half is real —
 * `documents`, `documentRequests`, `attachments`, `activity` and
 * `enrollments` come back empty from the API itself (no table backs them
 * yet), not faked here, so a real id never mixes with unrelated mock
 * fixture content.
 */
export async function getStudent(id: string): Promise<StudentDetail | null> {
  const response = await apiFetch(`/api/v1/students/${id}`)
  if (!response.ok) return null
  return response.json()
}
