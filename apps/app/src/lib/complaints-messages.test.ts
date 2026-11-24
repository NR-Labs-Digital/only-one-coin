import { describe, expect, it } from 'vitest'
import { FIELD_ERROR_CODES } from '@ooc/domain/fields'
import en from '@/messages/en.json'
import es from '@/messages/es-PE.json'
import pt from '@/messages/pt-BR.json'

/**
 * The complaints book form (OOC-63) shows the API's field codes through its
 * own `complaints.errors` — every code has a sentence in every locale, plus
 * the two the form adds (a mistyped amount, an unticked box). A code without
 * one would print the key on the screen.
 */
describe('complaints book error messages', () => {
  it.each([
    ['es-PE', es],
    ['pt-BR', pt],
    ['en', en],
  ])('%s has a sentence for every field code', (_locale, messages) => {
    const errors = (messages as unknown as { complaints: { errors: Record<string, string> } }).complaints.errors
    expect(Object.keys(errors).sort()).toEqual([...FIELD_ERROR_CODES, 'amount', 'accept'].sort())
  })

  it('carries the same keys in all three locales', () => {
    const keys = (value: unknown, prefix = ''): string[] =>
      typeof value === 'object' && value !== null
        ? Object.entries(value).flatMap(([key, inner]) => keys(inner, `${prefix}${key}.`))
        : [prefix]
    const of = (messages: unknown) => keys((messages as { complaints: unknown }).complaints).sort()
    expect(of(pt)).toEqual(of(es))
    expect(of(en)).toEqual(of(es))
  })
})
