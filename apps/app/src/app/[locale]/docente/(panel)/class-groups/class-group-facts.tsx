'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { ClassGroupRow } from '@/lib/backoffice/types'
import { formatDate, type Locale } from '@/lib/format'
import { BoIcon } from '@/components/backoffice/icons'

/**
 * The three facts that tell one class group from another, each under its own
 * label: the code (with a copy button — it is what the teacher pastes into
 * a message to coordination), the days and time, and the start and end of the
 * module the group is running. Shared by the list card and the open group's
 * header, so both read the same way.
 */
export function ClassGroupFacts({
  group,
  className = '',
}: {
  group: Pick<ClassGroupRow, 'code' | 'weekdays' | 'startTime' | 'startDate' | 'endDate'>
  className?: string
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  return (
    <dl className={`grid grid-cols-2 gap-x-6 gap-y-2.5 ${className}`}>
      <Fact label={t('class_facts.code')}>
        <span className="inline-flex items-center gap-1">
          <span className="tabular-nums">{group.code}</span>
          <CopyButton value={group.code} />
        </span>
      </Fact>
      <Fact label={t('class_facts.schedule')}>
        <span className="tabular-nums">
          {`${group.weekdays.map((day) => t(`weekday.${day}`)).join(' · ')} · ${group.startTime}`}
        </span>
      </Fact>
      <Fact label={t('class_group.field_start')}>
        <span className="tabular-nums">{formatDate(group.startDate, locale)}</span>
      </Fact>
      <Fact label={t('class_group.field_end')}>
        <span className="tabular-nums">{formatDate(group.endDate, locale)}</span>
      </Fact>
    </dl>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="truncate text-sm font-medium text-ink">{children}</dd>
    </div>
  )
}

function CopyButton({ value }: { value: string }) {
  const t = useTranslations('bo')
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard refused (insecure context, permission) — the code is still
      // on screen to select by hand.
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={copied ? t('class_facts.copied') : t('class_facts.copy')}
      title={copied ? t('class_facts.copied') : t('class_facts.copy')}
      className={`relative z-10 grid size-6 place-items-center rounded-md transition ${
        copied ? 'text-emerald-600' : 'text-muted-foreground hover:bg-sky-soft hover:text-brand-blue'
      }`}
    >
      <BoIcon name={copied ? 'check' : 'copy'} size={13} />
    </button>
  )
}
