import { redirect } from '@/i18n/navigation'
import { whatsappAiArrivalQuery } from '@/lib/enrollment/checkout'

/**
 * `/enrollment/wa` — the link the WhatsApp AI assistant sends (OOC-139).
 *
 * A short path rather than a query parameter the bot has to copy exactly: it
 * forwards to the one checkout, `/enrollment`, with the channel set to
 * `whatsapp_ai` and everything else the link carried (course, class group,
 * campaign tags) kept. The seller's link (`?src=whatsapp`) is untouched, so
 * the backoffice can tell what the bot brings in from what a person closed.
 *
 * Attribution, not a token (`CLAUDE.md` §2): no secret, no session, no price.
 * Anybody can open it, and all it does is label the enrollment's channel.
 */
export default async function WhatsappAiEnrollmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale } = await params
  const query = whatsappAiArrivalQuery(await searchParams)
  redirect({ href: { pathname: '/enrollment', query }, locale })
}
