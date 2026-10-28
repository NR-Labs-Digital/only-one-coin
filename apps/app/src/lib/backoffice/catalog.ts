import { apiFetch } from './api-client'
import type {
  AcademicPeriodItem,
  ClassGroupItem,
  ClassGroupRoster,
  CourseDetail,
  CourseRow,
  LanguageItem,
  TeacherOption,
  WaitlistItem,
} from './types'

/** The API's course item; `language` is the Language's name, `languageId` its record (OOC-128). */
interface ApiCourse extends Omit<CourseRow, 'language'> {
  language: string
  languageId: string | null
}

/**
 * The course's language as the screens use it: the Language record's id and
 * name. A course nobody filed yet (no record) carries an empty id — the
 * course form then asks for one.
 */
function toCourseRow({ languageId, ...course }: ApiCourse): CourseRow {
  return { ...course, language: { id: languageId ?? '', name: course.language } }
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
    return body.items.map(toCourseRow)
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

/** The live languages, by name (OOC-128). `null` = the API failed. */
export async function listCatalogLanguages(): Promise<LanguageItem[] | null> {
  try {
    const response = await apiFetch('/api/v1/catalog/languages')
    if (!response.ok) return null
    const body = (await response.json()) as { items: LanguageItem[] }
    return body.items
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
