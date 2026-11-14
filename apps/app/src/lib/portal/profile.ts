import { cookies } from 'next/headers'
import { cleanProfileId, pathWithProfile, PORTAL_PROFILE_COOKIE } from './profile-cookie'

/** The profile the reader chose (OOC-147), read on the server; null = the default. */
export async function selectedProfileId(): Promise<string | null> {
  return cleanProfileId((await cookies()).get(PORTAL_PROFILE_COOKIE)?.value)
}

/** A portal API path about the chosen profile. */
export async function withProfile(path: string): Promise<string> {
  return pathWithProfile(path, await selectedProfileId())
}
