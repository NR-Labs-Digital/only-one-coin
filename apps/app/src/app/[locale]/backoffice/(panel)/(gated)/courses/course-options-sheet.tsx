'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { CourseOptions, CourseRow } from '@/lib/backoffice/types'
import { BoIcon } from '@/components/backoffice/icons'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { CourseOptionFields } from './course-option-fields'

/**
 * Course options — what coordination may change on a course that already
 * exists. The name and the language are not here: renaming a course after
 * class groups hang off it rewrites what students enrolled in, and that
 * belongs to whoever may create one.
 *
 * Price is absent for the same reason it is absent from the course type: it is
 * versioned and never edited, and the enrollment freezes the version in force
 * (CLAUDE.md §5).
 */
export function CourseOptionsSheet({
  course,
  onClose,
  onSave,
}: {
  course: CourseRow | null
  onClose: () => void
  onSave: (course: CourseRow, options: CourseOptions) => void
}) {
  const t = useTranslations('bo')
  const [draft, setDraft] = useState<CourseOptions | null>(null)

  // The draft follows whichever course the sheet was opened on, and is thrown
  // away on close — a half-edited course must not leak into the next one.
  useEffect(() => {
    setDraft(
      course && {
        minAge: course.minAge,
        modules: course.modules,
        totalHours: course.totalHours,
        certificateRule: course.certificateRule,
        allowsFreeze: course.allowsFreeze,
        allowsTransfer: course.allowsTransfer,
        active: course.active,
      },
    )
  }, [course])

  return (
    <Sheet
      open={course !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent
        side="right"
        closeLabel={t('course_options.close')}
        className="w-full gap-0 overflow-y-auto bg-white p-0 sm:max-w-md"
      >
        {course && draft && (
          <>
            <SheetHeader className="gap-2 border-b border-line p-5 pr-14">
              <SheetTitle className="text-base font-semibold text-ink">
                {course.name}
              </SheetTitle>
              <SheetDescription>
                {t('course_options.subtitle', { language: course.language.name })}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-4 p-5">
              <p className="flex items-start gap-2 rounded-lg border border-dashed border-line bg-sky-soft px-3 py-2 text-xs text-muted-foreground">
                <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
                {t('course_options.applies_forward')}
              </p>

              <CourseOptionFields value={draft} onChange={setDraft} />

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onSave(course, draft)
                    onClose()
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep"
                >
                  <BoIcon name="check" size={16} />
                  {t('course_options.save')}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
                >
                  {t('course_options.cancel')}
                </button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
