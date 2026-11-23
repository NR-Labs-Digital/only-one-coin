'use client'

import { useSyncExternalStore } from 'react'
import { formatLocalDateTime } from '@/lib/backoffice/local-date-time'
import type { Locale } from '@/lib/format'

const noop = () => () => {}

/**
 * An instant in the timezone of whoever reads the page (OOC-186). A server
 * page cannot know the reader's zone, so the server renders nothing and the
 * browser fills it in after hydration — never a Lima hour that looks right to
 * someone in Lisbon.
 */
export function LocalDateTime({ iso, locale }: { iso: string; locale: Locale }) {
  const text = useSyncExternalStore(
    noop,
    () => formatLocalDateTime(iso, locale),
    () => null,
  )
  return <time dateTime={iso}>{text}</time>
}
