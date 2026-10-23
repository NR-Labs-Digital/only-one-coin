'use client'

import { useTranslations } from 'next-intl'
import type { ClassGroupRow } from '@/lib/backoffice/types'
import { BoIcon, type BoIconName } from '@/components/backoffice/icons'
import { parseClassLink } from '@/lib/backoffice/class-links'

/**
 * Where the teacher goes to give the class: the Meet and the Classroom of the
 * group, as external links. Nothing is embedded or integrated — the platform
 * only carries the address coordination pasted (CLAUDE.md §2).
 *
 * Both buttons are always there; a link not set yet leaves its button greyed
 * out rather than gone, so the teacher sees what is missing at a glance.
 */
export function ClassLinks({
  group,
  className = '',
}: {
  group: Pick<ClassGroupRow, 'meetUrl' | 'classroomUrl'>
  className?: string
}) {
  const t = useTranslations('bo')
  /* Whatever the row carries is re-checked before it becomes an `href`: a
     link that is not the Google host it claims to be is treated as missing. */
  const meetUrl = group.meetUrl ? parseClassLink(group.meetUrl, 'meet') : null
  const classroomUrl = group.classroomUrl
    ? parseClassLink(group.classroomUrl, 'classroom')
    : null

  return (
    <span className={`flex flex-wrap items-center gap-2 ${className}`}>
      <ExternalButton href={meetUrl} icon="video" label={t('class_links.meet')} />
      <ExternalButton
        href={classroomUrl}
        icon="courses"
        label={t('class_links.classroom')}
      />
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
