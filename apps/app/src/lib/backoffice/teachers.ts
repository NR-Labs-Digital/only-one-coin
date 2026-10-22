import { apiFetch } from './api-client'
import type { CourseLanguage, TeacherDetail, TeacherRow } from './types'
import { teacherDirectorySearchParams, type TeacherDirectoryQuery } from './teacher-directory-query'

export {
  parseTeacherDirectoryQuery,
  type TeacherDirectoryQuery,
} from './teacher-directory-query'

/** The API's row: languages are catalog text there, not `{id, name}`. */
type ApiTeacherRow = Omit<TeacherRow, 'languages'> & { languages: string[] }
type ApiTeacherDetail = Omit<TeacherDetail, 'languages'> & { languages: string[] }

/**
 * `courses.language` is catalog text ("Italiano"), not a code — so it is its
 * own id, the same way the catalog screens read it.
 */
export function toLanguage(name: string): CourseLanguage {
  return { id: name, name }
}

/** One page of the roster, as `GET /api/v1/teachers` answers it. */
export interface TeacherDirectoryPage {
  items: TeacherRow[]
  /** Teachers matching every filter, across every page. */
  total: number
  page: number
  pageSize: number
  /** The tabs over the search and language; the chips over those plus the tab. */
  counts: { active: number; inactive: number; free: number; contract: number }
  /** The alert window the API's contract filter used (OOC-41) — the badge
   * reads the same number, so the two never disagree. */
  contractAlertDays: number
}

/**
 * One page of the teacher roster (OOC-78). Search, tab, filters and paging
 * all run in Postgres. `null` means the API failed — the page shows an error
 * state, because an empty roster and "could not load" are different facts.
 */
export async function listTeachers(query: TeacherDirectoryQuery): Promise<TeacherDirectoryPage | null> {
  const search = teacherDirectorySearchParams(query).toString()
  try {
    const response = await apiFetch(`/api/v1/teachers${search ? `?${search}` : ''}`)
    if (!response.ok) return null
    const body = (await response.json()) as Omit<TeacherDirectoryPage, 'items'> & { items: ApiTeacherRow[] }
    return { ...body, items: body.items.map((row) => ({ ...row, languages: row.languages.map(toLanguage) })) }
  } catch {
    return null
  }
}

/** One teacher's file. `null` for an unknown id and for an API failure alike. */
export async function getTeacher(id: string): Promise<TeacherDetail | null> {
  try {
    const response = await apiFetch(`/api/v1/teachers/${encodeURIComponent(id)}`)
    if (!response.ok) return null
    const body = (await response.json()) as ApiTeacherDetail
    return { ...body, languages: body.languages.map(toLanguage) }
  } catch {
    return null
  }
}
