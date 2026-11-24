import { describe, expect, it } from 'vitest'
import { PERMISSION_AREAS, PERMISSION_CATALOG } from '@ooc/domain/permission-catalog'
import en from '@/messages/backoffice/en.json'
import es from '@/messages/backoffice/es-PE.json'
import pt from '@/messages/backoffice/pt-BR.json'
import { customCargosOf, groupByArea, profileHolds, type StaffProfileItem } from './permission-matrix'
import { cargoLabel, cargoValue, parseCargoValue } from './cargos'

/**
 * OOC-57 / OOC-183: every permission and area the API can hand the screen has
 * a name in each locale (CLAUDE.md §4 — never a permission key on screen), and
 * a cargo created in Equipo travels through the selects and back intact.
 */
describe('permission labels', () => {
  it.each([
    ['es-PE', es],
    ['pt-BR', pt],
    ['en', en],
  ])('%s names every permission, area and the custom cargo', (_locale, messages) => {
    const bo = messages.bo as unknown as {
      permissions: { area: Record<string, string>; capability: Record<string, Record<string, string>> }
      role: Record<string, string>
    }
    /* Nested on the dot, the way next-intl reads `capability.students.view`. */
    const named = Object.entries(bo.permissions.capability).flatMap(([area, labels]) =>
      Object.keys(labels).map((action) => `${area}.${action}`),
    )
    expect(named.sort()).toEqual(PERMISSION_CATALOG.map((entry) => entry.key).sort())
    expect(Object.keys(bo.permissions.area).sort()).toEqual([...PERMISSION_AREAS].sort())
    expect(bo.role.custom).toBeTruthy()
  })
})

const profiles: StaffProfileItem[] = [
  {
    id: 'b-billing',
    role: 'billing',
    name: null,
    permissions: ['payments.view', 'payments.settle'],
    locked: false,
    mfaRequired: true,
    members: 2,
    editable: true,
  },
  {
    id: 'c-horarios',
    role: null,
    name: 'Horarios',
    permissions: ['catalog.view', 'catalog.courses_edit'],
    locked: false,
    mfaRequired: false,
    members: 2,
    editable: true,
  },
]

describe('permission matrix helpers', () => {
  it('reads what a cargo holds', () => {
    expect(profileHolds(profiles[0]!, 'payments.settle')).toBe(true)
    expect(profileHolds(profiles[1]!, 'payments.settle')).toBe(false)
  })

  it('groups in area order and leaves empty areas out', () => {
    const entries = [
      { key: 'settings.read', area: 'settings' as const },
      { key: 'payments.view', area: 'payments' as const },
    ]
    expect(groupByArea(entries, PERMISSION_AREAS).map((group) => group.area)).toEqual(['payments', 'settings'])
  })

  it('offers only the cargos created in Equipo to the selects', () => {
    expect(customCargosOf(profiles)).toEqual([{ id: 'c-horarios', name: 'Horarios' }])
  })
})

describe('cargo values', () => {
  it('round-trips a board role and a created cargo', () => {
    expect(parseCargoValue(cargoValue('sales', null))).toEqual({ role: 'sales', profileId: null })
    expect(parseCargoValue(cargoValue('custom', 'c-horarios'))).toEqual({ role: 'custom', profileId: 'c-horarios' })
  })

  it("names a created cargo by what was typed, and falls back to the locale's word", () => {
    const label = (role: string) => `role:${role}`
    expect(cargoLabel('custom', 'Horarios', label)).toBe('Horarios')
    expect(cargoLabel('custom', null, label)).toBe('role:custom')
    expect(cargoLabel('billing', null, label)).toBe('role:billing')
  })
})
