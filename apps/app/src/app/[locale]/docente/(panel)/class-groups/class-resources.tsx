'use client'

import { useTranslations } from 'next-intl'
import { parseClassLink, type ClassroomLink } from '@/lib/backoffice/class-links'
import { ClassLinks, ExternalButton } from '@/components/backoffice/class-links'

/**
 * Everything a teacher needs to open before giving the class, in one place:
 *
 * - **The class group's Classroom** — the link coordination pastes with the
 *   teacher in the backoffice (OOC-98); the Meet lives inside it, and the
 *   confirmed students open the same link from their portal. Read-only here.
 * - **Module material** — the Drive link coordination sets once per module
 *   on the course (OOC-94), picked by the module the class group teaches
 *   (OOC-100). The door only appears once there is a link to open: no module
 *   set, or a course without material, shows nothing. A class group that
 *   teaches the full course (OOC-130) gets one door per module instead.
 *
 * External links only, never an integration (CLAUDE.md §2), and each one is
 * checked against the Google host it claims before it becomes an `href`.
 */
export function ClassResources({
  classroomLinks,
  module,
  moduleMaterialsUrl,
  courseMaterialUrls,
}: {
  classroomLinks: ClassroomLink[]
  module: number | null
  moduleMaterialsUrl: string | null
  courseMaterialUrls: string[]
}) {
  const t = useTranslations('bo')
  const materialsUrl = moduleMaterialsUrl ? parseClassLink(moduleMaterialsUrl, 'drive') || null : null

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('class_resources.title')}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <ClassLinks classroomLinks={classroomLinks} />
        {materialsUrl && (
          <ExternalButton
            href={materialsUrl}
            icon="doc"
            label={
              module === null
                ? t('class_resources.materials')
                : t('class_resources.materials_module', { number: module })
            }
          />
        )}
        {courseMaterialUrls.map((url, index) => {
          const href = parseClassLink(url, 'drive')
          return href ? (
            <ExternalButton
              key={index}
              href={href}
              icon="doc"
              label={t('class_resources.materials_module', { number: index + 1 })}
            />
          ) : null
        })}
      </div>
    </div>
  )
}
