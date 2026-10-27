'use client'

import { useTranslations } from 'next-intl'
import { BoIcon, type BoIconName } from '@/components/backoffice/icons'
import { parseClassLink } from '@/lib/backoffice/class-links'

/**
 * Where the teacher goes to give the class: the group's Classroom, where the
 * Meet lives, as an external link (OOC-98). Nothing is embedded or integrated
 * — the platform only carries the address coordination pasted (CLAUDE.md §2).
 *
 * The button is always there; a link not set yet leaves it greyed out rather
 * than gone, so the teacher sees what is missing at a glance.
 */
export function ClassLinks({
  classroomUrl,
  className = '',
}: {
  classroomUrl: string | null
  className?: string
}) {
  const t = useTranslations('bo')
  /* Whatever the row carries is re-checked before it becomes an `href`: a
     link that is not the Google host it claims to be is treated as missing. */
  const href = classroomUrl ? parseClassLink(classroomUrl, 'classroom') || null : null

  return (
    <span className={`flex flex-wrap items-center gap-2 ${className}`}>
      <ExternalButton href={href} icon="courses" label={t('class_links.classroom')} />
    </span>
  )
}

/**
 * One door to an external link. Always on screen, in the same place: with a
 * link it opens it, without one it sits greyed out — no sentence explaining
 * what is missing, the disabled button already says it.
 */
export function ExternalButton({
  href,
  icon,
  label,
}: {
  href: string | null
  icon: BoIconName
  label: string
}) {
  const base =
    'inline-flex min-h-tap items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition sm:min-h-0 sm:py-1.5'
  if (!href) {
    return (
      <span
        aria-disabled="true"
        className={`${base} cursor-not-allowed border-line bg-slate-50 text-slate-400`}
      >
        <BoIcon name={icon} size={15} />
        {label}
      </span>
    )
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${base} border-line bg-white text-ink hover:border-brand-blue hover:text-brand-blue`}
    >
      <BoIcon name={icon} size={15} />
      {label}
      <BoIcon name="external" size={13} className="text-muted-foreground" />
    </a>
  )
}
