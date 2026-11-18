import { describe, expect, it } from 'vitest'
import { classroomUrlOf, meetUrlOf, parseClassLink, safeMeetUrl } from './class-links'

describe('parseClassLink', () => {
  it('accepts a Drive folder as module material', () => {
    expect(parseClassLink('https://drive.google.com/drive/folders/x', 'drive')).toBe(
      'https://drive.google.com/drive/folders/x',
    )
  })

  it('accepts Docs as module material (OOC-94)', () => {
    expect(parseClassLink('https://docs.google.com/presentation/d/x', 'drive')).toBe(
      'https://docs.google.com/presentation/d/x',
    )
  })

  it.each([
    'https://drive.google.com.evil.com/x',
    'http://drive.google.com/x',
    'javascript:alert(1)',
    'https://evil.com/?u=drive.google.com',
  ])('refuses %s as module material', (raw) => {
    expect(parseClassLink(raw, 'drive')).toBeNull()
  })

  it('tells a blank field from a wrong one', () => {
    expect(parseClassLink('   ', 'drive')).toBe('')
  })

  it('keeps classroom on its own host', () => {
    expect(parseClassLink('https://docs.google.com/x', 'classroom')).toBeNull()
  })
})

describe('classroomUrlOf (OOC-98)', () => {
  it('sends the pasted link normalized', () => {
    expect(classroomUrlOf('  https://CLASSROOM.google.com/c/abc ')).toBe('https://classroom.google.com/c/abc')
  })

  it('sends null for an emptied field, so the link is cleared', () => {
    expect(classroomUrlOf('')).toBeNull()
    expect(classroomUrlOf('   ')).toBeNull()
  })

  it.each(['https://meet.google.com/abc-defg-hij', 'http://classroom.google.com/c/abc', 'classroom'])(
    'calls %s invalid',
    (raw) => {
      expect(classroomUrlOf(raw)).toBe('invalid')
    },
  )
})

describe('meetUrlOf (OOC-159)', () => {
  it('normalizes a Meet link and reads a blank field as none', () => {
    expect(meetUrlOf('  https://MEET.google.com/abc-defg-hij ')).toBe('https://meet.google.com/abc-defg-hij')
    expect(meetUrlOf('   ')).toBeNull()
  })

  it.each(['http://meet.google.com/abc', 'https://meet.google.com.evil.io/abc', 'https://classroom.google.com/c/abc', 'javascript:alert(1)'])(
    'calls %s invalid',
    (bad) => {
      expect(meetUrlOf(bad)).toBe('invalid')
    },
  )
})

describe('safeMeetUrl (OOC-159)', () => {
  it('lets only a Meet link become an href', () => {
    expect(safeMeetUrl('https://meet.google.com/abc-defg-hij')).toBe('https://meet.google.com/abc-defg-hij')
    expect(safeMeetUrl('https://evil.example/meet')).toBeNull()
    expect(safeMeetUrl(null)).toBeNull()
    expect(safeMeetUrl(undefined)).toBeNull()
  })
})
