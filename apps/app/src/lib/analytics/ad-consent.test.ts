import { describe, expect, it } from 'vitest'
import {
  AD_CONSENT_COOKIE,
  adConsentCookie,
  isAnalyticsHandoffId,
  readAdConsent,
} from '@ooc/domain/analytics'
import { validPixelId } from './pixels'

describe('the pixel-banner answer (OOC-47)', () => {
  it('reads only the values we write', () => {
    expect(readAdConsent('')).toBeNull()
    expect(readAdConsent(`a=1; ${AD_CONSENT_COOKIE}=granted; b=2`)).toBe('granted')
    expect(readAdConsent(`${AD_CONSENT_COOKIE}=denied`)).toBe('denied')
    expect(readAdConsent(`${AD_CONSENT_COOKIE}=yes`)).toBeNull()
    expect(readAdConsent(`x${AD_CONSENT_COOKIE}=granted`)).toBeNull()
  })

  it('shares the answer on the configured parent domain only', () => {
    const shared = adConsentCookie('granted', { domain: '.onlyonecoin.edu.pe', secure: true })
    expect(shared).toContain('Domain=.onlyonecoin.edu.pe')
    expect(shared).toContain('Secure')
    expect(adConsentCookie('denied', { secure: false })).not.toContain('Domain=')
    // Anything that is not a bare domain is not spliced into the cookie.
    expect(adConsentCookie('granted', { domain: 'x; Path=/evil', secure: true })).not.toContain('Domain=')
  })

  it('accepts only a UUID as the handed-over PostHog id', () => {
    expect(isAnalyticsHandoffId('0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b')).toBe(true)
    expect(isAnalyticsHandoffId('<script>')).toBe(false)
  })

  it('accepts only letters and digits as a pixel id', () => {
    expect(validPixelId(' 123456789012345 ')).toBe('123456789012345')
    expect(validPixelId('C4ABCDEF12345')).toBe('C4ABCDEF12345')
    expect(validPixelId(undefined)).toBeNull()
    expect(validPixelId('123"><script>')).toBeNull()
  })
})
