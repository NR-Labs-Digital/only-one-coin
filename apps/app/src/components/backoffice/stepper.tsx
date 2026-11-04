import { BoIcon } from '@/components/backoffice/icons'

/**
 * The stepper: where you are, what is behind you, and what is left. Horizontal
 * because the steps are a path across the top of the work, not a list beside
 * it — and because with one step on screen at a time, this strip is the only
 * thing telling somebody how much of the work they have already decided —
 * a new e-mail send, a new class group.
 *
 * Steps behind are links: going back to re-read what you wrote must never cost
 * the draft. Steps ahead are not — they are gated by what is missing here.
 *
 * It answers what the reader just did (OOC-135): the current step rings, turns
 * red with `invalid` when the step refused to advance, and the bar under the
 * strip fills as steps get done. A step marked in `optional` says so under its
 * name, before anybody reaches it.
 */
export function Stepper({
  steps,
  current,
  labelOf,
  onPick,
  invalid = false,
  optional = [],
  optionalLabel,
}: {
  steps: string[]
  current: number
  labelOf: (key: string) => string
  onPick: (key: string) => void
  invalid?: boolean
  optional?: string[]
  optionalLabel?: string
}) {
  const progress = steps.length > 1 ? (current / (steps.length - 1)) * 100 : 100
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex items-start gap-1 overflow-x-auto px-1 pb-1 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {steps.map((key, position) => {
          const active = position === current
          const done = position < current
          return (
            <li key={key} className="flex min-w-0 flex-1 items-start gap-1">
              <button
                type="button"
                disabled={!done && !active}
                onClick={() => onPick(key)}
                aria-current={active ? 'step' : undefined}
                className="group flex min-w-16 flex-1 flex-col items-center gap-1.5 px-0.5 text-center disabled:cursor-default"
              >
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-full border text-sm font-semibold transition ${
                    active
                      ? invalid
                        ? 'border-red-600 bg-red-600 text-white ring-4 ring-red-600/15'
                        : 'border-brand-blue bg-brand-blue text-white ring-4 ring-brand-blue/15'
                      : done
                        ? 'border-brand-yellow bg-brand-yellow text-ink group-hover:ring-4 group-hover:ring-brand-yellow/30'
                        : 'border-line bg-white text-muted-foreground'
                  }`}
                >
                  {active && invalid ? (
                    <BoIcon name="alert" size={16} />
                  ) : done ? (
                    <BoIcon name="check" size={16} />
                  ) : (
                    position + 1
                  )}
                </span>
                <span
                  /* Wraps rather than truncates: a step called "COMO SE ESC…"
                     is one nobody can tell apart from the next. */
                  className={`text-[11px] uppercase leading-tight tracking-wide ${
                    active
                      ? 'font-bold text-ink'
                      : done
                        ? 'font-semibold text-ink'
                        : 'font-semibold text-muted-foreground'
                  }`}
                >
                  {labelOf(key)}
                </span>
                {optionalLabel && optional.includes(key) && (
                  <span className="rounded-full bg-sky-soft px-1.5 py-0.5 text-[10px] font-semibold leading-none text-brand-blue">
                    {optionalLabel}
                  </span>
                )}
              </button>
              {position < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className={`mt-5 h-0.5 flex-1 rounded-full ${done ? 'bg-brand-yellow' : 'bg-line'}`}
                />
              )}
            </li>
          )
        })}
      </ol>
      <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-brand-blue transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}
