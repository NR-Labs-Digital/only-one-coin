import { apiFetch } from './api-client'
import type { ClassroomAccountList } from './types'

/**
 * The shared Classroom accounts and who uses each (OOC-196), read on the
 * server. Null when the API fails or refuses the session — the screen says it
 * could not load, and the teacher form hides the picker rather than offering
 * an empty one.
 */
export async function listClassroomAccounts(): Promise<ClassroomAccountList | null> {
  try {
    const response = await apiFetch('/api/v1/classroom-accounts')
    if (!response.ok) return null
    return (await response.json()) as ClassroomAccountList
  } catch {
    return null
  }
}
