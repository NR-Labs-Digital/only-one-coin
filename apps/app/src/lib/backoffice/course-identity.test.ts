import { describe, expect, it } from 'vitest'
import { blankedIdentityFields, identityOf, identityPatch } from './course-identity'

/** A course that predates OOC-36: the level column landed blank. */
const LEGACY = { name: 'Ruso', language: { name: 'Ruso' }, level: '', summary: '' }

describe('identityPatch', () => {
  it('carries nothing when nothing changed, even over a blank level', () => {
    expect(identityPatch(LEGACY, identityOf(LEGACY))).toEqual({})
  })

  it('carries only the fields that changed, trimmed', () => {
    const next = { ...identityOf(LEGACY), name: '  Ruso Básico ', level: ' A1 ' }
    expect(identityPatch(LEGACY, next)).toEqual({ name: 'Ruso Básico', level: 'A1' })
  })

  it('ignores whitespace-only edits', () => {
    expect(identityPatch(LEGACY, { ...identityOf(LEGACY), name: 'Ruso  ' })).toEqual({})
  })
})

describe('blankedIdentityFields', () => {
  it('lets a legacy course with a blank level save its other fields', () => {
    expect(blankedIdentityFields(identityPatch(LEGACY, identityOf(LEGACY)))).toEqual([])
  })

  it('names a required field the edit would clear', () => {
    const course = { ...LEGACY, level: 'A1' }
    const patch = identityPatch(course, { ...identityOf(course), level: '   ', name: '' })
    expect(blankedIdentityFields(patch)).toEqual(['name', 'level'])
  })

  it('lets the summary go blank', () => {
    const course = { ...LEGACY, summary: 'Curso de ruso' }
    expect(blankedIdentityFields(identityPatch(course, { ...identityOf(course), summary: '' }))).toEqual([])
  })
})
