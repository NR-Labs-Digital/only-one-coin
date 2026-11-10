import { describe, expect, it } from 'vitest'
import { whatsappChatUrl } from './whatsapp-link'

describe('whatsappChatUrl', () => {
  it('keeps the country code of a number written with +', () => {
    expect(whatsappChatUrl('+51 987 654 321')).toBe('https://wa.me/51987654321')
    expect(whatsappChatUrl('+55 (11) 98765-4321')).toBe('https://wa.me/5511987654321')
  })

  it('reads 00 as the international prefix', () => {
    expect(whatsappChatUrl('0051987654321')).toBe('https://wa.me/51987654321')
  })

  it('reads a bare nine-digit mobile starting with 9 as Peruvian', () => {
    expect(whatsappChatUrl('987654321')).toBe('https://wa.me/51987654321')
    expect(whatsappChatUrl('987-654-321')).toBe('https://wa.me/51987654321')
  })

  it('gives no link for a number it cannot place', () => {
    expect(whatsappChatUrl('014567890')).toBeNull()
    expect(whatsappChatUrl('12345')).toBeNull()
    expect(whatsappChatUrl('+1234')).toBeNull()
    expect(whatsappChatUrl('')).toBeNull()
    expect(whatsappChatUrl(null)).toBeNull()
  })
})
