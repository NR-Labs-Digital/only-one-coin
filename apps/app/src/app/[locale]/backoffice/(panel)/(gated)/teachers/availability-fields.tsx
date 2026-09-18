'use client'

import { useTranslations } from 'next-intl'
import type { AvailabilitySlot, Weekday } from '@/lib/backoffice/types'
import { TIME_OPTIONS, toMinutes, WEEK, weeklyHours } from '@/lib/backoffice/availability'
import { BoIcon } from '@/components/backoffice/icons'

const fieldClass =
  'rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

/** A window that ends before it starts is not a window. */
function isValid(slot: AvailabilitySlot): boolean {
  return toMinutes(slot.endTime) > toMinutes(slot.startTime)
}

export function slotsAreValid(slots: AvailabilitySlot[]): boolean {
  return slots.every(isValid)
}

/**
 * Weekly availability editor: one row per window, day + from + to.
 *
 * A list rather than a grid to fill in, because that is how the availability
 * arrives — "martes y jueves de 6 a 10" — and a 7×32 grid of checkboxes asks
 * for thirty clicks to say the same thing. The grid is how it is *read*, on the
 * ficha; this is how it is written.
 */
export function AvailabilityFields({
  value,
  onChange,
}: {
  value: AvailabilitySlot[]
  onChange: (slots: AvailabilitySlot[]) => void
}) {
  const t = useTranslations('bo')

  function update(index: number, patch: Partial<AvailabilitySlot>) {
    onChange(value.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)))
  }

  function add() {
    const last = value[value.length - 1]
    onChange([
      ...value,
      last
        ? { ...last, weekday: last.weekday }
        : { weekday: 'mon' as Weekday, startTime: '18:00', endTime: '21:00' },
    ])
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('availability.empty_hint')}</p>
      )}

      {value.map((slot, index) => (
        <div
          key={`${slot.weekday}-${index}`}
          className="flex flex-wrap items-center gap-2"
        >
          <select
            aria-label={t('availability.field_weekday')}
            value={slot.weekday}
            onChange={(event) =>
              update(index, { weekday: event.target.value as Weekday })
            }
            className={fieldClass}
          >
            {WEEK.map((weekday) => (
              <option key={weekday} value={weekday}>
                {t(`weekday_long.${weekday}`)}
              </option>
            ))}
          </select>

          <span className="text-xs text-muted-foreground">
            {t('availability.field_from')}
          </span>
          <select
            aria-label={t('availability.field_from')}
            value={slot.startTime}
            onChange={(event) => update(index, { startTime: event.target.value })}
            className={`${fieldClass} tabular-nums`}
          >
            {TIME_OPTIONS.map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </select>

          <span className="text-xs text-muted-foreground">
            {t('availability.field_to')}
          </span>
          <select
            aria-label={t('availability.field_to')}
            value={slot.endTime}
            onChange={(event) => update(index, { endTime: event.target.value })}
            className={`${fieldClass} tabular-nums ${
              isValid(slot) ? '' : 'border-red-400 text-red-600'
            }`}
          >
            {TIME_OPTIONS.map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </select>

          {!isValid(slot) && (
            <span className="text-xs font-semibold text-red-600">
              {t('availability.invalid_range')}
            </span>
          )}

          <button
            type="button"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
            aria-label={t('availability.remove')}
            title={t('availability.remove')}
            /* Red at rest, not only on hover: it is the one control on the row
               that destroys something, and a grey × next to two dropdowns
               reads as decoration until it has already fired. */
            className="grid h-8 w-8 place-items-center rounded-lg text-red-600 transition hover:bg-red-50 hover:text-red-700"
          >
            <BoIcon name="close" size={16} />
          </button>
        </div>
      ))}

      <div className="mt-1 flex items-center gap-3">
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-muted-foreground transition hover:text-ink"
        >
          <BoIcon name="plus" size={16} />
          {t('availability.add')}
        </button>
        {value.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {t('availability.weekly_hours', { hours: weeklyHours(value) })}
          </span>
        )}
      </div>
    </div>
  )
}
