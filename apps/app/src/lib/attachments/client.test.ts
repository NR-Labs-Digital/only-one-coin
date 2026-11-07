import { describe, expect, it } from 'vitest'
import { checkFile, contentTypeOf } from './client'

const limits = { maxBytes: 1000, contentTypes: ['application/pdf', 'image/jpeg', 'image/heic'] }
const file = (name: string, type: string, size: number) => new File([new Uint8Array(size)], name, { type })

describe('attachment client check', () => {
  it('accepts a listed type within the cap', () => {
    expect(checkFile(file('dni.pdf', 'application/pdf', 500), limits)).toBeNull()
  })

  it('refuses an unlisted type, an empty file and one over the cap', () => {
    expect(checkFile(file('x.exe', 'application/x-msdownload', 10), limits)).toBe('unsupported_type')
    expect(checkFile(file('dni.pdf', 'application/pdf', 0), limits)).toBe('too_large')
    expect(checkFile(file('dni.pdf', 'application/pdf', 1001), limits)).toBe('too_large')
  })

  it('reads a HEIC photo the browser reported without a type by its extension', () => {
    expect(contentTypeOf(file('IMG_0001.HEIC', '', 10))).toBe('image/heic')
    expect(checkFile(file('IMG_0001.heic', '', 10), limits)).toBeNull()
  })
})
