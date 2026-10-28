import { apiFetch } from './api-client'
import type {
  AcademicPeriodItem,
  ClassGroupItem,
  ClassGroupRoster,
  CourseDetail,
  CourseRow,
  TeacherOption,
  WaitlistItem,
} from './types'
import { languageKey } from './teacher-allocation'

/** The API's course item; `language` is a plain name there (no languages table). */
interface ApiCourse extends Omit<CourseRow, 'language'> {
  language: string
}

/**
 * `courses.language` is catalog text ("Inglés"), not a code. Its id is the
 * compared key (no case, accent or stray space), so "INGLES" and "Inglés" can
 * never open two groups on the screen; the name is the spelling most courses
 * of that language use — the API's own rule for writing it.
 */
function toCourseRow(course: ApiCourse, spellings?: Map<string, string>): CourseRow {
  const id = languageKey(course.language)
  return { ...course, language: { id, name: spellings?.get(id) ?? course.language } }
}

function catalogSpellings(courses: ApiCourse[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>()
  for (const course of courses) {
    const key = languageKey(course.language)
    const byKey = counts.get(key) ?? new Map<string, number>()
    byKey.set(course.language, (byKey.get(course.language) ?? 0) + (course.active ? 1 : 0))
    counts.set(key, byKey)
  }
  return new Map(
    [...counts].map(([key, byKey]) => [
      key,
      [...byKey].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
    ]),
  )
}

/**
 * `null` means the API failed — the page shows an error state, because a
 * silent empty catalog reads as data loss (same contract as listStudents).
 */
export async function listCatalogCourses(): Promise<CourseRow[] | null> {
  try {
    const response = await apiFetch('/api/v1/catalog/courses')
    if (!response.ok) return null
    const body = (await response.json()) as { items: ApiCourse[] }
    const spellings = catalogSpellings(body.items)
    return body.items.map((course) => toCourseRow(course, spellings))
  } catch {
    return null
  }
}

export async function getCatalogCourse(id: string): Promise<CourseDetail | null> {
  try {
    const response = await apiFetch(`/api/v1/catalog/courses/${encodeURIComponent(id)}`)
    if (!response.ok) return null
    const body = (await response.json()) as { course: ApiCourse; plans: CourseDetail['plans'] }
    return { course: toCourseRow(body.course), plans: body.plans }
  } catch {
    return null
  }
}

/** Sales periods, newest first. `null` = the API failed. */
export async function listCatalogPeriods(): Promise<AcademicPeriodItem[] | null> {
  try {
    const response = await apiFetch('/api/v1/catalog/periods')
    if (!response.ok) return null
    const body = (await response.json()) as { items: AcademicPeriodItem[] }
    return body.items
  } catch {
    return null
  }
}

/** Class groups, optionally of one period. `null` = the API failed. */
export async function listCatalogClassGroups(periodId?: string): Promise<ClassGroupItem[] | null> {
  try {
    const query = periodId ? `?periodId=${encodeURIComponent(periodId)}` : ''
    const response = await apiFetch(`/api/v1/catalog/class-groups${query}`)
    if (!response.ok) return null
    const body = (await response.json()) as { items: ClassGroupItem[] }
    return body.items
  } catch {
    return null
  }
}

/** The roster as the class group form needs it (OOC-80); null when the read failed. */
export async function listTeacherOptions(): Promise<TeacherOption[] | null> {
  try {
    const response = await apiFetch('/api/v1/catalog/teacher-options')
    if (!response.ok) return null
    const body = (await response.json()) as { items: TeacherOption[] }
    return body.items
  } catch {
    return null
  }
}

export async function getCatalogClassGroup(id: string): Promise<ClassGroupItem | null> {
  try {
    const response = await apiFetch(`/api/v1/catalog/class-groups/${encodeURIComponent(id)}`)
    if (!response.ok) return null
    return (await response.json()) as ClassGroupItem
  } catch {
    return null
  }
}

/** Who is enrolled in a class group. `null` = the API failed. */
export async function getClassGroupRoster(id: string): Promise<ClassGroupRoster | null> {
  try {
    const response = await apiFetch(
      `/api/v1/catalog/class-groups/${encodeURIComponent(id)}/roster`,
    )
    if (!response.ok) return null
    return (await response.json()) as ClassGroupRoster
  } catch {
    return null
  }
}

/** Who is waiting for a seat in a full class group. `null` = the API failed. */
export async function listCatalogWaitlist(id: string): Promise<WaitlistItem[] | null> {
  try {
    const response = await apiFetch(
      `/api/v1/catalog/class-groups/${encodeURIComponent(id)}/waitlist`,
    )
    if (!response.ok) return null
    const body = (await response.json()) as { items: WaitlistItem[] }
    return body.items
  } catch {
    return null
  }
}
