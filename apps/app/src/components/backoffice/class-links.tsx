'use client'

import { useTranslations } from 'next-intl'
import { BoIcon, type BoIconName } from '@/components/backoffice/icons'
import { safeClassroomLinks, type ClassroomLink } from '@/lib/backoffice/class-links'

/**
 * Where the teacher goes to give the class: the group's Classroom, where the
 * Meet lives, as an external link — one per module the class group teaches
 * (OOC-98, OOC-144). Nothing is embedded or integrated — the platform only
 * carries the addresses coordination pasted (CLAUDE.md §2).
 *
 * With no link yet the button is still there, greyed out rather than gone, so
 * the teacher sees what is missing at a glance. A link labelled by module
 * says which module's Classroom it is; the old single link carries no module.
 */
export function ClassLinks({
  classroomLinks,
  className = '',
}: {
  classroomLinks: readonly ClassroomLink[]
  className?: string
}) {
  const t = useTranslations('bo')
  /* Whatever the row carries is re-checked before it becomes an `href`: a
     link that is not the Google host it claims to be is treated as missing. */
  const links = safeClassroomLinks(classroomLinks)

  return (
    <span className={`flex flex-wrap items-center gap-2 ${className}`}>
      {links.length === 0 ? (
        <ExternalButton href={null} icon="courses" label={t('class_links.classroom')} />
      ) : (
        links.map((link) => (
          <ExternalButton
            key={link.module ?? 'legacy'}
            href={link.url}
            icon="courses"
            label={
              link.module === null
                ? t('class_links.classroom')
                : t('class_links.classroom_module', { module: link.module })
            }
          />
        ))
      )}
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
