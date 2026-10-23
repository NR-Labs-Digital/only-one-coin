import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { DayColumn } from '@/lib/backoffice/availability'
import { AutoGrid } from '@/components/layout/auto-grid'

/**
 * The week as seven columns: the windows the teacher declared free, with the
 * class groups already allocated laid on top — amber when one starts outside
 * every window, because then either the availability or the allocation is
 * stale and a human has to know which.
 *
 * Shared by the teacher's ficha (coordination allocating the next group) and
 * the teacher's own schedule screen (the teacher reading their week) — the
 * same picture answers both.
 */
export function WeekGrid({
  columns,
  hrefOf,
}: {
  columns: DayColumn[]
  /** Where a class group chip leads — each screen has its own door to it. */
  hrefOf: (classGroupId: string) => string
}) {
  const t = useTranslations('bo')

  return (
    <>
      <AutoGrid min="6rem" gap="gap-2">
        {columns.map((column) => (
          <div
            key={column.weekday}
            className="flex flex-col gap-1.5 rounded-lg border border-line bg-sky-soft p-2"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t(`weekday.${column.weekday}`)}
            </p>

            {column.slots.length === 0 && column.classes.length === 0 && (
              <p className="text-xs text-slate-400">—</p>
            )}

            {column.slots.map((slot, index) => (
              <p
                key={`${slot.startTime}-${index}`}
                className="rounded border border-dashed border-brand-blue/40 bg-white px-1.5 py-1 text-[11px] font-semibold tabular-nums text-brand-blue-deep"
              >
                {`${slot.startTime}–${slot.endTime}`}
              </p>
            ))}

            {column.classes.map((item) => (
              <Link
                key={`${item.id}-${item.startTime}`}
                href={hrefOf(item.id)}
                title={item.courseName}
                className={`rounded px-1.5 py-1 text-[11px] font-semibold transition ${
                  item.outside
                    ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                    : 'bg-brand-blue text-white hover:bg-brand-blue-deep'
                }`}
              >
                <span className="block truncate tabular-nums">
                  {`${item.startTime} · ${item.code}`}
                </span>
              </Link>
            ))}
          </div>
        ))}
      </AutoGrid>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded border border-dashed border-brand-blue/60 bg-white" />
          {t('availability.legend_free')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded bg-brand-blue" />
          {t('availability.legend_allocated')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded bg-amber-300" />
          {t('availability.legend_outside')}
        </span>
      </div>
    </>
  )
}
