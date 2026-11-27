'use client'

import { useTranslations } from 'next-intl'
import { HelpHint } from '@/components/backoffice/help-hint'
import { parseClassLink, type ClassroomLink } from '@/lib/backoffice/class-links'
import { ClassLinks, ExternalButton } from '@/components/backoffice/class-links'

/**
 * Everything a teacher needs to open before giving the class, in one place:
 *
 * - **The class group's Classroom** — the link coordination pastes with the
 *   teacher in the backoffice (OOC-98), and its **Meet** (OOC-159); the
 *   confirmed students open the same links from their portal. Read-only here.
 * - **Module material** — the Drive link coordination sets once per module
 *   on the course (OOC-94). The module the class group teaches (OOC-100) sits
 *   next to the class links; every other module of the course follows in its
 *   own row, so the teacher can prepare the classes ahead (OOC-194). A class
 *   group that teaches the full course (OOC-130), or has no module set, has no
 *   current one, and gets one door per module in that row. A course without
 *   material shows nothing.
 *
 * External links only, never an integration (CLAUDE.md §2), and each one is
 * checked against the Google host it claims before it becomes an `href`.
 */
export function ClassResources({
  classroomLinks,
  meetUrl,
  module,
  moduleMaterialsUrl,
  courseMaterialUrls,
}: {
  classroomLinks: ClassroomLink[]
  meetUrl: string | null
  module: number | null
  moduleMaterialsUrl: string | null
  courseMaterialUrls: string[]
}) {
  const t = useTranslations('bo')
  const materialsUrl = moduleMaterialsUrl ? parseClassLink(moduleMaterialsUrl, 'drive') || null : null
  // Every module's door but the current one's, which is already up top.
  const otherMaterials = courseMaterialUrls
    .map((url, index) => ({ number: index + 1, href: parseClassLink(url, 'drive') }))
    .filter(({ number, href }) => href && !(materialsUrl && number === module))

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('class_resources.title')}
        <HelpHint what={t('help.teach_resources_what')} how={t('help.teach_resources_how')} />
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <ClassLinks classroomLinks={classroomLinks} meetUrl={meetUrl} />
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
      </div>
      {otherMaterials.length > 0 && (
        <>
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {materialsUrl ? t('class_resources.other_modules_title') : t('class_resources.all_modules_title')}
            <HelpHint
              what={t('help.teach_course_materials_what')}
              how={t('help.teach_course_materials_how')}
            />
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {otherMaterials.map(({ number, href }) => (
              <ExternalButton
                key={number}
                href={href}
                icon="doc"
                label={t('class_resources.materials_module', { number })}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
