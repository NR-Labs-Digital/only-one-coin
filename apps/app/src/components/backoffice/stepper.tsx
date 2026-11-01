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
 */
export function Stepper({
  steps,
  current,
  labelOf,
  onPick,
}: {
  steps: string[]
  current: number
  labelOf: (key: string) => string
  onPick: (key: string) => void
}) {
  return (
    <ol className="flex items-start gap-1 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
              className="flex min-w-16 flex-1 flex-col items-center gap-1.5 px-0.5 text-center disabled:cursor-default"
            >
              <span
                className={`grid size-8 shrink-0 place-items-center rounded-full border text-sm font-semibold transition ${
                  active
                    ? 'border-brand-blue bg-brand-blue text-white'
                    : done
                      ? 'border-brand-yellow bg-brand-yellow text-ink'
                      : 'border-line bg-white text-muted-foreground'
                }`}
              >
                {done ? <BoIcon name="check" size={16} /> : position + 1}
              </span>
              <span
                /* Wraps rather than truncates: a step called "COMO SE ESC…"
                   is one nobody can tell apart from the next. */
                className={`text-[11px] font-semibold uppercase leading-tight tracking-wide ${
                  active ? 'text-ink' : 'text-muted-foreground'
                }`}
              >
                {labelOf(key)}
              </span>
            </button>
            {position < steps.length - 1 && (
              <span
                aria-hidden="true"
                className={`mt-4 h-px flex-1 ${done ? 'bg-brand-yellow' : 'bg-line'}`}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}
