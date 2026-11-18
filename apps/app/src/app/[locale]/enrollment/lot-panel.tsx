'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { CheckoutDraft, PublicCatalog } from '@/lib/enrollment/types'
import { courseById, groupById, planOfCourse } from '@/lib/enrollment/checkout'
import { formatDate, formatMoney, type Locale } from '@/lib/format'
import { Card, GhostButton } from '@/components/enrollment/ui'
import { CheckoutIcon } from '@/components/enrollment/icons'

/**
 * The courses already in this checkout (OOC-158), above the one being filled:
 * several courses — one student's, or several children's — paid with one
 * receipt. Each can be taken out, which gives its seat back. On step 1 of an
 * added course, the reader can also step back and add nothing after all.
 */
export function LotPanel({
  catalog,
  draft,
  onRemove,
  onCancelAdd,
}: {
  catalog: PublicCatalog
  draft: CheckoutDraft
  onRemove: (index: number) => void
  /** Only on step 1 of a course being added. */
  onCancelAdd?: () => void
}) {
  const t = useTranslations('enrollment')
  const locale = useLocale() as Locale
  if (draft.lot.length === 0) return null

  return (
    <Card className="mb-5 p-5">
      <p className="mb-1 text-sm font-semibold text-ink">{t('lot.panel_title', { count: draft.lot.length })}</p>
      <p className="mb-3 text-xs text-muted-foreground">{t('lot.panel_subtitle')}</p>
      <ul className="divide-y divide-line">
        {draft.lot.map((entry, index) => {
          const course = courseById(catalog, entry.course.courseId)
          const group = groupById(catalog, entry.course.classGroupId)
          const plan = planOfCourse(catalog, entry.course.courseId)
          return (
            <li key={entry.hold.id} className="flex items-start justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-ink">
                  {`${entry.student.firstName} ${entry.student.lastName}`}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[course?.name, group ? t('lot.starts_on', { date: formatDate(group.startDate, locale) }) : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {plan && (
                  <span className="text-sm font-semibold tabular-nums text-ink">
                    {formatMoney(plan.amountCents, plan.currency, locale)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  aria-label={t('lot.remove', { course: course?.name ?? '' })}
                  title={t('lot.remove', { course: course?.name ?? '' })}
                  className="grid min-h-tap min-w-tap place-items-center rounded-full text-muted-foreground transition hover:bg-red-50 hover:text-red-600"
                >
                  <CheckoutIcon name="trash" size={16} />
                </button>
              </span>
            </li>
          )
        })}
      </ul>
      {onCancelAdd && (
        <div className="mt-3">
          <GhostButton onClick={onCancelAdd}>
            <CheckoutIcon name="arrow-left" size={16} />
            {t('lot.cancel_add')}
          </GhostButton>
        </div>
      )}
    </Card>
  )
}
