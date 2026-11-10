/**
 * The `wa.me` link that opens a chat with a student, from the number on their
 * file — the review queue's contact shortcut (OOC-146). It only opens the
 * conversation in the reader's own WhatsApp: nothing is sent by the platform,
 * so it is not the WhatsApp integration that CLAUDE.md §2 leaves out.
 *
 * `wa.me` wants the full international number, digits only. A number written
 * with `+` already carries its country code. One written without it is read
 * as Peruvian when it is the nine-digit mobile format (starting with 9) that
 * the checkout's own form takes — the shape the legacy import left behind.
 * Anything else cannot be told apart from a foreign number, so there is no
 * link rather than a chat with a stranger.
 */
const PERU_COUNTRY_CODE = '51'
const PERU_MOBILE = /^9\d{8}$/
/** E.164 tops out at 15 digits; fewer than 8 is not a reachable mobile. */
const MIN_DIGITS = 8
const MAX_DIGITS = 15

export function whatsappChatUrl(phone: string | null | undefined): string | null {
  if (!phone) return null
  const trimmed = phone.trim()
  const digits = trimmed.replace(/\D/g, '')

  let international: string
  if (trimmed.startsWith('+')) international = digits
  else if (digits.startsWith('00')) international = digits.slice(2)
  else if (PERU_MOBILE.test(digits)) international = `${PERU_COUNTRY_CODE}${digits}`
  else return null

  if (international.length < MIN_DIGITS || international.length > MAX_DIGITS) return null
  return `https://wa.me/${international}`
}
