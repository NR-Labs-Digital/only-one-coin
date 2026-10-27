'use client'

import { useTranslations } from 'next-intl'
import { parseClassLink } from '@/lib/backoffice/class-links'
import { ClassLinks, ExternalButton } from '@/components/backoffice/class-links'

/**
 * Everything a teacher needs to open before giving the class, in one place:
 *
 * - **The class group's Classroom** — the link coordination pastes with the
 *   teacher in the backoffice (OOC-98); the Meet lives inside it, and the
 *   confirmed students open the same link from their portal. Read-only here.
 * - **Module material** — the Drive link coordination sets once per module.
 *   Which module a class group is teaching has no API yet (OOC-100), so the
 *   door only appears once there is a link to open.
 *
 * External links only, never an integration (CLAUDE.md §2), and each one is
 * checked against the Google host it claims before it becomes an `href`.
 */
export function ClassResources({
  classroomUrl,
  moduleMaterialsUrl,
}: {
  classroomUrl: string | null
  moduleMaterialsUrl: string | null
}) {
  const t = useTranslations('bo')
  const materialsUrl = moduleMaterialsUrl ? parseClassLink(moduleMaterialsUrl, 'drive') || null : null

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('class_resources.title')}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <ClassLinks classroomUrl={classroomUrl} />
        {materialsUrl && (
          <ExternalButton href={materialsUrl} icon="doc" label={t('class_resources.materials')} />
        )}
      </div>
    </div>
  )
}
