import type { CourseRow } from './types'

/**
 * What only whoever may create a course may rewrite (`PATCH /catalog/courses/:id`).
 * `language` is the Language id picked from the list (OOC-128), sent as `languageId`.
 */
export type CourseIdentity = { name: string; language: string; level: string; summary: string }

/** The fields the API refuses blank. The summary may go blank — the portal hides "Sobre el curso" then. */
const REQUIRED = ['name', 'language', 'level'] as const
export type RequiredIdentityField = (typeof REQUIRED)[number]

type IdentitySource = Pick<CourseRow, 'name' | 'level' | 'summary'> & {
  language: Pick<CourseRow['language'], 'id'>
}

export function identityOf(course: IdentitySource): CourseIdentity {
  return {
    name: course.name,
    language: course.language.id,
    level: course.level,
    summary: course.summary,
  }
}

/** The identity fields that differ from the course, trimmed — what the PATCH carries. */
export function identityPatch(course: IdentitySource, next: CourseIdentity): Partial<CourseIdentity> {
  const before = identityOf(course)
  return Object.fromEntries(
    (Object.keys(next) as (keyof CourseIdentity)[])
      .map((key) => [key, next[key].trim()] as const)
      .filter(([key, value]) => value !== before[key]),
  )
}

/**
 * The required fields the patch would clear. Only what the patch carries
 * counts: courses that predate OOC-36 hold `level = ''`, and a blank the
 * reader did not touch never reaches the API — gating on the whole draft left
 * those courses with a Save button that never enabled (OOC-126).
 */
export function blankedIdentityFields(patch: Partial<CourseIdentity>): RequiredIdentityField[] {
  return REQUIRED.filter((key) => patch[key] === '')
}
