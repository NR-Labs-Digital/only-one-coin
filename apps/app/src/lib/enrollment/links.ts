import { publicAppOrigin } from '@/lib/hosts'

/**
 * The checkout links staff hand out (OOC-139). Spanish has no locale prefix
 * (CLAUDE.md §4), and the audience of both is the Peruvian public.
 *
 * - `web`: the plain form — the channel it records is `web`.
 * - `whatsapp_ai`: the short link the WhatsApp AI assistant sends; it
 *   forwards to the form with the channel set to `whatsapp_ai`.
 *
 * Attribution, never a token (CLAUDE.md §2): nothing in them is secret.
 */
export const ENROLLMENT_LINK_PATHS = {
  web: '/enrollment',
  whatsapp_ai: '/enrollment/wa',
} as const

export type EnrollmentLinkKind = keyof typeof ENROLLMENT_LINK_PATHS

export function enrollmentLinks(currentOrigin: string): Record<EnrollmentLinkKind, string> {
  const origin = publicAppOrigin(currentOrigin)
  return {
    web: `${origin}${ENROLLMENT_LINK_PATHS.web}`,
    whatsapp_ai: `${origin}${ENROLLMENT_LINK_PATHS.whatsapp_ai}`,
  }
}
