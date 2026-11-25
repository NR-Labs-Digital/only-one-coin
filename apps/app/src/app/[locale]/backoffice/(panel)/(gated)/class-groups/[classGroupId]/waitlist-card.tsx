'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type {
  CatalogErrorKey,
  ClassGroupItem,
  NationalIdType,
  WaitlistItem,
} from '@/lib/backoffice/types'
import { catalogWrite } from '@/lib/backoffice/catalog-client'
import { formatDate, type Locale } from '@/lib/format'
import { Card } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { Toast } from '@/components/backoffice/controls'
import { HelpHint } from '@/components/backoffice/help-hint'

const fieldClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

const smallButtonClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40'

/** The API's own floor for `GET /api/v1/students/search?q=` — shorter is not a search. */
const MIN_QUERY_LENGTH = 2

/** Long enough to finish a word, short enough to feel like typing. */
const SEARCH_DEBOUNCE_MS = 300

type LeaveReason = 'withdrawn' | 'removed_by_staff'

const LEAVE_REASONS: LeaveReason[] = ['withdrawn', 'removed_by_staff']

interface StudentMatch {
  id: string
  firstName: string
  lastName: string
  nationalIdType: NationalIdType
  nationalId: string
}

/**
 * Who is waiting for a seat in this class group, first come first served.
 *
 * The waitlist is manual (OOC-35): coordination adds the person who asked on
 * WhatsApp, and when a seat frees up — capacity raised, a seat handed back —
 * the card says so and links the first in line to the manual enrollment, which
 * closes their place in the queue. Nobody is enrolled from here: the seat, the
 * price and the payment are the enrollment's own flow (CLAUDE.md §1).
 *
 * Every write goes through `apps/api` and the page is re-read afterwards.
 */
export function WaitlistCard({
  group,
  entries,
  canManage,
  canEnroll,
}: {
  group: ClassGroupItem
  entries: WaitlistItem[]
  canManage: boolean
  canEnroll: boolean
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const router = useRouter()

  const [removing, setRemoving] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<CatalogErrorKey | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const free = group.capacity - group.seatsTaken
  const full = free <= 0
  const first = entries[0]

  async function leave(entryId: string, reason: LeaveReason) {
    setPending(true)
    setError(null)
    const result = await catalogWrite(
      `/waitlist/${encodeURIComponent(entryId)}/leave`,
      'POST',
      { reason },
    )
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setRemoving(null)
    setToast(t('waitlist.removed'))
    router.refresh()
  }

  async function join(studentId: string): Promise<boolean> {
    setPending(true)
    setError(null)
    const result = await catalogWrite(
      `/class-groups/${encodeURIComponent(group.id)}/waitlist`,
      'POST',
      { studentId },
    )
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return false
    }
    setToast(t('waitlist.added'))
    router.refresh()
    return true
  }

  return (
    <Card className="p-5">
      <span className="flex items-center gap-1.5">
        <p className="text-sm font-semibold text-ink">{t('waitlist.title')}</p>
        <HelpHint what={t('help.cg_waitlist_what')} how={t('help.cg_waitlist_how')} />
      </span>

      {free > 0 && first && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <span className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <BoIcon name="seat" size={16} />
            {t('waitlist.seat_free', { count: free })}
          </span>
          {canEnroll && (
            <Link
              href={`/backoffice/enrollments?student=${encodeURIComponent(first.studentId)}&classGroup=${encodeURIComponent(group.id)}`}
              className="inline-flex min-h-tap items-center gap-1 text-sm font-semibold text-brand-blue transition hover:text-brand-blue-deep"
            >
              {t('waitlist.enroll_first', { name: first.studentName })}
              <BoIcon name="chevron-right" size={14} />
            </Link>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t('waitlist.empty')}</p>
      ) : (
        <ol className="mt-3 flex flex-col divide-y divide-line/70 rounded-lg border border-line">
          {entries.map((entry, index) => (
            <li key={entry.id} className="flex flex-col gap-2 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sky-soft text-xs font-semibold tabular-nums text-brand-blue">
                  {index + 1}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-ink">{entry.studentName}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {`${t('students.document', {
                      type: t(`national_id_type.${entry.nationalIdType}`),
                      number: entry.nationalId,
                    })} · ${t('waitlist.joined_on', { date: formatDate(entry.joinedAt, locale) })}`}
                  </span>
                </span>
                {canManage && removing !== entry.id && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setError(null)
                      setRemoving(entry.id)
                    }}
                    className={smallButtonClass}
                  >
                    {t('waitlist.remove')}
                  </button>
                )}
              </div>

              {canManage && removing === entry.id && (
                <div className="flex flex-col gap-2 rounded-lg bg-sky-soft px-3 py-2">
                  <span className="text-xs font-medium text-ink">{t('waitlist.remove_reason')}</span>
                  <div className="flex flex-wrap gap-2">
                    {LEAVE_REASONS.map((reason) => (
                      <button
                        key={reason}
                        type="button"
                        disabled={pending}
                        onClick={() => void leave(entry.id, reason)}
                        className={smallButtonClass}
                      >
                        {t(`waitlist.reason_${reason}`)}
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => setRemoving(null)}
                      className={smallButtonClass}
                    >
                      {t('waitlist.cancel')}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {canManage &&
        (full ? (
          group.active && (
            <AddToWaitlist
              waitingIds={entries.map((entry) => entry.studentId)}
              disabled={pending}
              onPick={join}
            />
          )
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">{t('waitlist.only_when_full')}</p>
        ))}

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {t(`catalog_errors.${error}`)}
        </p>
      )}

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </Card>
  )
}

/**
 * Student search for the waitlist — the same `GET /api/v1/students/search?q=` the
 * manual enrollment picks from. Only the newest request may write the list: a
 * slow answer for "Mar" must never land over the one for "Maria".
 */
function AddToWaitlist({
  waitingIds,
  disabled,
  onPick,
}: {
  waitingIds: string[]
  disabled: boolean
  onPick: (studentId: string) => Promise<boolean>
}) {
  const t = useTranslations('bo')
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<StudentMatch[] | null>(null)
  const inflight = useRef<AbortController | null>(null)

  useEffect(() => {
    const needle = query.trim()
    inflight.current?.abort()
    inflight.current = null
    if (needle.length < MIN_QUERY_LENGTH) {
      setMatches(null)
      return
    }

    const timer = window.setTimeout(() => {
      const controller = new AbortController()
      inflight.current = controller
      fetch(`/api/v1/students/search?q=${encodeURIComponent(needle)}`, { signal: controller.signal })
        .then((response) =>
          response.ok ? (response.json() as Promise<{ items?: StudentMatch[] }>) : { items: [] },
        )
        .then((page) => {
          if (inflight.current !== controller) return
          setMatches(Array.isArray(page?.items) ? page.items : [])
        })
        .catch(() => {
          if (controller.signal.aborted || inflight.current !== controller) return
          setMatches([])
        })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
      inflight.current?.abort()
      inflight.current = null
    }
  }, [query])

  // Already waiting is refused by the API anyway (`waitlist_already_joined`);
  // not offering them keeps the list honest.
  const offered = matches?.filter((match) => !waitingIds.includes(match.id)) ?? null

  async function pick(studentId: string) {
    if (await onPick(studentId)) {
      setQuery('')
      setMatches(null)
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
      <label className="flex flex-col gap-1 sm:max-w-md">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('waitlist.add')}
        </span>
        <span className="relative">
          <BoIcon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('waitlist.search_placeholder')}
            className={`${fieldClass} w-full pl-9`}
          />
        </span>
      </label>

      {offered &&
        (offered.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('waitlist.no_students_found')}</p>
        ) : (
          <ul className="flex flex-col overflow-hidden rounded-lg border border-line sm:max-w-md">
            {offered.map((match) => (
              <li key={match.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void pick(match.id)}
                  className="flex min-h-tap w-full flex-col items-start gap-0.5 border-b border-line/70 px-3 py-2 text-left transition last:border-b-0 hover:bg-sky-soft disabled:opacity-60"
                >
                  <span className="text-sm font-medium text-ink">
                    {`${match.firstName} ${match.lastName}`}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t('students.document', {
                      type: t(`national_id_type.${match.nationalIdType}`),
                      number: match.nationalId,
                    })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  )
}
