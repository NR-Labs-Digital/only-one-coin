import { describe, expect, it, vi } from 'vitest'
import { isOwnerEmail } from '@/lib/backoffice/permissions'
import type { FlagOverride } from './env'
import type { FlagOverrides } from './overrides'
import { FEATURE_FLAG_KEYS, type FeatureFlagKey, type FeatureSurface } from './registry'
import {
  isHiddenFromEverybody,
  resolveFlags,
  resolveUnlock,
  surfaceHasHiddenFlags,
  type FlagInputs,
} from './resolve'

function production(
  overrides: FlagOverrides = {},
  env: Partial<Record<FeatureFlagKey, FlagOverride>> = {},
): FlagInputs {
  return { overrides, envOverride: (key) => env[key], appEnv: 'production' }
}

function unlockFor(surface: FeatureSurface, email: string | null, preview = false) {
  return resolveUnlock({
    surface,
    preview,
    readViewerEmail: () => Promise.resolve(email),
    isOwnerEmail,
  })
}

describe('resolveFlags', () => {
  it('gives everybody the switchboard and the registry when nothing is unlocked', () => {
    const view = resolveFlags(production({ 'backoffice.students': false }), null)

    expect(view.flags['backoffice.students']).toBe(false)
    expect(view.flags['teacher.agenda']).toBe(false)
    expect(view.flags['backoffice.payments']).toBe(true)
    expect(view.flags).toEqual(view.everybody)
  })

  it('shows an owner every staff flag, and keeps reporting it off for everybody', () => {
    const view = resolveFlags(production({ 'backoffice.students': false }), 'owner')

    expect(view.flags['backoffice.students']).toBe(true)
    expect(view.flags['teacher.agenda']).toBe(true)
    expect(view.everybody['backoffice.students']).toBe(false)
    expect(isHiddenFromEverybody(view, 'backoffice.students')).toBe(true)
    expect(isHiddenFromEverybody(view, 'backoffice.payments')).toBe(false)
  })

  it('leaves the student portal to the cookie alone for an owner', () => {
    const view = resolveFlags(production({ 'portal.payments': false }), 'owner')

    expect(view.flags['portal.payments']).toBe(false)
  })

  it('unlocks every surface for the preview cookie', () => {
    const view = resolveFlags(production({ 'portal.payments': false, 'backoffice.students': false }), 'preview')

    expect(view.flags['portal.payments']).toBe(true)
    expect(view.flags['backoffice.students']).toBe(true)
    expect(view.everybody['portal.payments']).toBe(false)
  })

  it('does not lock an owner out of the panel when its root flag goes off', () => {
    const view = resolveFlags(production({ backoffice: false }), 'owner')

    expect(view.flags.backoffice).toBe(true)
    expect(view.flags['backoffice.staff']).toBe(true)
    expect(view.flags.teacher).toBe(true)
    expect(view.everybody.backoffice).toBe(false)
    expect(view.everybody['backoffice.staff']).toBe(false)
    expect(view.everybody.teacher).toBe(false)
  })

  it('unlocks over the env var the same way the cookie always has', () => {
    const view = resolveFlags(production({}, { backoffice: 'off' }), 'owner')

    expect(view.flags.backoffice).toBe(true)
    expect(view.everybody.backoffice).toBe(false)
  })

  it('has nothing to unlock outside production', () => {
    const view = resolveFlags({ overrides: {}, envOverride: () => undefined, appEnv: 'preview' }, 'owner')

    for (const key of FEATURE_FLAG_KEYS) expect(view.everybody[key]).toBe(true)
  })

  it('tells each staff surface apart when deciding whether to show the banner', () => {
    // In the registry today, only docente sections are off in production.
    const view = resolveFlags(production(), 'owner')

    expect(surfaceHasHiddenFlags(view, 'teacher')).toBe(true)
    expect(surfaceHasHiddenFlags(view, 'backoffice')).toBe(false)
    expect(surfaceHasHiddenFlags(resolveFlags(production(), null), 'teacher')).toBe(false)
  })
})

describe('resolveUnlock', () => {
  it('unlocks a staff surface for an owners’ e-mail domain', async () => {
    await expect(unlockFor('backoffice', 'dev@nrlabsdigital.com')).resolves.toBe('owner')
    await expect(unlockFor('teacher', 'Dev@NRLabsDigital.com')).resolves.toBe('owner')
    // `admin.com` is an owners' domain too (CLAUDE.md §8, 17/09/2026).
    await expect(unlockFor('backoffice', 'admin@admin.com')).resolves.toBe('owner')
  })

  it('does not unlock anything for staff outside the owners’ domains', async () => {
    await expect(unlockFor('backoffice', 'coordinacion@onlyonecoin.edu.pe')).resolves.toBeNull()
    await expect(unlockFor('backoffice', 'someone@nrlabsdigital.com.pe')).resolves.toBeNull()
  })

  it('never reads the session for the student portal', async () => {
    const readViewerEmail = vi.fn(() => Promise.resolve('dev@nrlabsdigital.com'))

    const unlock = await resolveUnlock({ surface: 'portal', preview: false, readViewerEmail, isOwnerEmail })

    expect(unlock).toBeNull()
    expect(readViewerEmail).not.toHaveBeenCalled()
  })

  it('lets the preview cookie win without asking who is browsing', async () => {
    const readViewerEmail = vi.fn(() => Promise.resolve(null))

    await expect(
      resolveUnlock({ surface: 'portal', preview: true, readViewerEmail, isOwnerEmail }),
    ).resolves.toBe('preview')
    await expect(
      resolveUnlock({ surface: 'backoffice', preview: true, readViewerEmail, isOwnerEmail }),
    ).resolves.toBe('preview')
    expect(readViewerEmail).not.toHaveBeenCalled()
  })

  it('resolves a page with no session as anybody else', async () => {
    await expect(unlockFor('backoffice', null)).resolves.toBeNull()
  })

  it('resolves a failed session read as anybody else instead of breaking the page', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const unlock = await resolveUnlock({
      surface: 'backoffice',
      preview: false,
      readViewerEmail: () => Promise.reject(new Error('API down')),
      isOwnerEmail,
    })

    expect(unlock).toBeNull()
    warn.mockRestore()
  })
})
