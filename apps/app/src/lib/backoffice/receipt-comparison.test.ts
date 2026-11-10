import { describe, expect, it } from 'vitest'
import { compareAmount, compareMethod, compareOperationNumber } from './receipt-comparison'

describe('receipt comparison', () => {
  it('compares the amount exactly, in cents', () => {
    expect(compareAmount(300, 300)).toBe('match')
    expect(compareAmount(300, 301)).toBe('differs')
    expect(compareAmount(300, 250)).toBe('differs')
    expect(compareAmount(300, null)).toBe('none')
  })

  it('compares the operation number the way the lock does', () => {
    expect(compareOperationNumber('123-785 15', '12378515')).toBe('match')
    expect(compareOperationNumber('ab12', 'AB12')).toBe('match')
    expect(compareOperationNumber('0012', '12')).toBe('differs')
    expect(compareOperationNumber(null, '12')).toBe('none')
    expect(compareOperationNumber('12', null)).toBe('none')
    expect(compareOperationNumber('--', '12')).toBe('none')
  })

  it('compares the payment method', () => {
    expect(compareMethod('yape', 'yape')).toBe('match')
    expect(compareMethod('yape', 'bcp')).toBe('differs')
    expect(compareMethod('yape', null)).toBe('none')
  })
})
