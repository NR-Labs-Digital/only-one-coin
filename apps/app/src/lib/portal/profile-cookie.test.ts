import { describe, expect, it } from 'vitest'
import { cleanProfileId, pathWithProfile, profileFromCookieString, PORTAL_PROFILE_COOKIE } from './profile-cookie'

const ID = '0192f0a0-0000-7000-8000-000000000001'

describe('portal profile cookie (OOC-147)', () => {
  it('lets only a well-formed id through', () => {
    expect(cleanProfileId(ID)).toBe(ID)
    expect(cleanProfileId('../../me')).toBeNull()
    expect(cleanProfileId('')).toBeNull()
    expect(cleanProfileId(undefined)).toBeNull()
  })

  it('adds the profile to a path, with or without a query already', () => {
    expect(pathWithProfile('/api/v1/portal/overview', ID)).toBe(`/api/v1/portal/overview?profile=${ID}`)
    expect(pathWithProfile('/api/v1/x?a=1', ID)).toBe(`/api/v1/x?a=1&profile=${ID}`)
    expect(pathWithProfile('/api/v1/portal/overview', null)).toBe('/api/v1/portal/overview')
  })

  it('reads the choice out of document.cookie, and ignores a tampered one', () => {
    expect(profileFromCookieString(`a=1; ${PORTAL_PROFILE_COOKIE}=${ID}; b=2`)).toBe(ID)
    expect(profileFromCookieString(`${PORTAL_PROFILE_COOKIE}=x%27or1`)).toBeNull()
    expect(profileFromCookieString('a=1')).toBeNull()
  })
})
