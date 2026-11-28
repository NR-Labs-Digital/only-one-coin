import { apiFetch } from './api-client'

/*
 * The owners' demo accesses (28/11/2026), as `apps/api` reports them. `kind`
 * is a code the screen translates, never shows.
 */

export type DemoAccessKind = 'student' | 'teacher'

export interface DemoAccessRow {
  id: string
  kind: DemoAccessKind
  email: string
  name: string
  courseName: string
  classGroupCode: string
  activated: boolean
  createdAt: string
  createdByName: string | null
  revokedAt: string | null
}

export interface DemoCourseOption {
  id: string
  name: string
  language: string
}

export interface DemoAccessesOverview {
  accesses: DemoAccessRow[]
  courses: DemoCourseOption[]
}

/** `null` when the API could not be read — the screen says so, never an empty list that looks real. */
export async function getDemoAccesses(): Promise<DemoAccessesOverview | null> {
  try {
    const response = await apiFetch('/api/v1/platform/demo-accesses')
    if (!response.ok) return null
    return (await response.json()) as DemoAccessesOverview
  } catch {
    return null
  }
}
