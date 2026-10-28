import { useTranslations } from 'next-intl'
import { StatusBadge } from '@/components/backoffice/ui'

/**
 * Where a flow stands, the same on the list, the journey and its own page: on,
 * off, or not sent by anything yet. The last one is not "off" — nobody switched
 * it, there is nothing behind it to switch (OOC-87).
 */
export function EmailFlowState({ emitted, enabled }: { emitted: boolean; enabled: boolean }) {
  const t = useTranslations('bo')

  if (!emitted) {
    return <StatusBadge tone="neutral" label={t('emails.state_not_emitted')} />
  }
  return (
    <StatusBadge
      tone={enabled ? 'success' : 'warning'}
      label={t(enabled ? 'emails.state_on' : 'emails.state_off')}
    />
  )
}
