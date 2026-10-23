'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { ClassGroupNotice } from '@/lib/backoffice/types'
import { formatDateTime, type Locale } from '@/lib/format'
import { BoIcon } from '@/components/backoffice/icons'

/** Long enough for "class moved, bring the workbook"; short enough to be read. */
const NOTICE_MAX = 500

/**
 * Notices to the class group: the teacher writes once and every enrolled
 * student reads it in their portal — on the course page and in the bell.
 *
 * Append-only on screen, like the observations: a notice that already went out
 * to the class is corrected by posting another, not by rewriting what thirty
 * students read. The send is screen-local for now: the real write is a usecase
 * in `apps/api` that checks the authenticated `teacher_id` against the class
 * group before publishing (CLAUDE.md §8).
 */
export function ClassNotices({
  initialNotices,
  teacherName,
  canPost,
}: {
  initialNotices: ClassGroupNotice[]
  teacherName: string
  /** A closed class group has nobody left to tell. */
  canPost: boolean
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  const [notices, setNotices] = useState(initialNotices)
  const [draft, setDraft] = useState('')
  const [sentLocally, setSentLocally] = useState(false)

  const text = draft.trim()
  const tooLong = draft.length > NOTICE_MAX

  function post() {
    if (text === '' || tooLong) return
    setNotices((current) => [
      {
        id: `notice_local_${Date.now()}`,
        text,
        postedAt: new Date().toISOString(),
        authorName: teacherName,
      },
      ...current,
    ])
    setDraft('')
    setSentLocally(true)
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-white">
      <header className="border-b border-line px-5 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
          <BoIcon name="email" size={16} className="text-brand-blue" />
          {t('class_notices.title')}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('class_notices.subtitle')}</p>
      </header>

      <div className="grid gap-0 @3xl/page:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Write on one side, the record on the other: a teacher about to
            post sees what the class was already told. */}
        <div className="flex flex-col gap-2 border-b border-line p-5 @3xl/page:border-b-0 @3xl/page:border-r">
          {canPost ? (
            <>
              <textarea
                rows={4}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={t('class_notices.placeholder')}
                aria-label={t('class_notices.title')}
                aria-invalid={tooLong}
                className={`w-full resize-y rounded-lg border bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted-foreground/70 focus:ring-2 ${
                  tooLong
                    ? 'border-red-400 focus:border-red-500 focus:ring-red-500/15'
                    : 'border-line focus:border-brand-blue focus:ring-brand-blue/15'
                }`}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  className={`text-xs tabular-nums ${tooLong ? 'font-semibold text-red-600' : 'text-muted-foreground'}`}
                >
                  {t('class_notices.count', { count: draft.length, max: NOTICE_MAX })}
                </span>
                <button
                  type="button"
                  onClick={post}
                  disabled={text === '' || tooLong}
                  className="inline-flex min-h-tap items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-default disabled:opacity-50 sm:min-h-0 sm:py-2"
                >
                  <BoIcon name="check" size={15} />
                  {t('class_notices.send')}
                </button>
              </div>
              {sentLocally && (
                <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
                  {t('class_notices.sent_local_only')}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t('class_notices.closed')}</p>
          )}
        </div>

        <div className="flex flex-col gap-3 p-5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('class_notices.history', { count: notices.length })}
          </p>
          {notices.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('class_notices.empty')}</p>
          ) : (
            <ol className="flex flex-col gap-3 border-l-2 border-sky pl-4">
              {notices.map((notice) => (
                <li key={notice.id} className="relative">
                  <span className="absolute -left-[1.4rem] top-1.5 size-2.5 rounded-full border-2 border-white bg-brand-blue" />
                  <p className="text-[11px] tabular-nums text-muted-foreground">
                    {`${formatDateTime(notice.postedAt, locale)} · ${notice.authorName}`}
                  </p>
                  <p className="mt-0.5 whitespace-pre-line text-sm leading-relaxed text-ink">
                    {notice.text}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  )
}
