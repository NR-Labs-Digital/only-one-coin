import { describe, expect, it } from 'vitest'
import { docToText, textToDoc } from './email-template-text'

/**
 * OOC-60: the e-mail editor shows each `{name}` as a chip and stores it back
 * as `{name}` — the round trip has to give the same text, or saving a block
 * nobody touched would change it.
 */
describe('email words ⇄ chip editor', () => {
  it.each([
    'Recibimos la matrícula de {studentName} en {courseName}.',
    '{studentName}',
    'Sin datos',
    '',
    '{a}{b} y {c}',
  ])('round-trips %j', (text) => {
    expect(docToText(textToDoc(text))).toBe(text)
  })

  it('turns each placeholder into a chip and leaves stray braces as text', () => {
    expect(textToDoc('Hola {studentName} {roto').content[0].content).toEqual([
      { type: 'text', text: 'Hola ' },
      { type: 'placeholder', attrs: { expression: 'studentName' } },
      { type: 'text', text: ' {roto' },
    ])
  })
})
