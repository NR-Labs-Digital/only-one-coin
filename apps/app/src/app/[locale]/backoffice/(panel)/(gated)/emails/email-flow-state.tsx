import { useTranslations } from 'next-intl'
import { StatusBadge } from '@/components/backoffice/ui'

/**
 * Where a flow stands, the same on the list, the journey and its own page:
 * sent by the platform, or not sent by anything yet. The second is not "off" —
 * nobody switched it, there is nothing behind it to switch (OOC-87). There is
 * no pause either: nothing in the platform can hold back an emitted template
 * (OOC-88), so the screen does not draw a switch that would do nothing.
 */
export function EmailFlowState({ emitted }: { emitted: boolean }) {
  const t = useTranslations('bo')

  return emitted ? (
    <StatusBadge tone="success" label={t('emails.state_on')} />
  ) : (
    <StatusBadge tone="neutral" label={t('emails.state_not_emitted')} />
  )
}
