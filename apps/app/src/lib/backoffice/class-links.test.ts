import { describe, expect, it } from 'vitest'
import { parseClassLink } from './class-links'

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

  it('keeps meet and classroom on their own host', () => {
    expect(parseClassLink('https://docs.google.com/x', 'meet')).toBeNull()
    expect(parseClassLink('https://docs.google.com/x', 'classroom')).toBeNull()
  })
})
