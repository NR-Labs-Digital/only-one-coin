import { describe, expect, it } from 'vitest'
import { gmailFromUsername, gmailUsernameOf } from './gmail'

describe('gmailFromUsername', () => {
  it('appends the fixed domain', () => {
    expect(gmailFromUsername('rosa.quispe')).toBe('rosa.quispe@gmail.com')
  })

  it('leaves an empty field empty', () => {
    expect(gmailFromUsername('')).toBe('')
    expect(gmailFromUsername('   ')).toBe('')
  })

  it('takes a pasted full address without doubling the domain', () => {
    expect(gmailFromUsername(' Rosa.Quispe@Gmail.com ')).toBe('Rosa.Quispe@gmail.com')
  })

  it('keeps another domain for the rules to refuse', () => {
    expect(gmailFromUsername('rosa@colegio.edu.pe')).toBe('rosa@colegio.edu.pe@gmail.com')
  })
})

describe('gmailUsernameOf', () => {
  it('shows the username of a Gmail address', () => {
    expect(gmailUsernameOf('rosa.quispe@gmail.com')).toBe('rosa.quispe')
  })

  it('shows an address from an older draft whole', () => {
    expect(gmailUsernameOf('rosa@hotmail.com')).toBe('rosa@hotmail.com')
  })

  it('round-trips what the field writes', () => {
    expect(gmailUsernameOf(gmailFromUsername('rosa.quispe'))).toBe('rosa.quispe')
  })
})
