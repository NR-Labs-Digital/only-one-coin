'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { answerComplaint, takeComplaint, type ComplaintStepResult } from '@/lib/backoffice/complaints-client'
import { HelpHint } from '@/components/backoffice/help-hint'

/** Mirrors MAX_COMPLAINT_ANSWER_LENGTH in the domain (the CHECK of 0079). */
const MAX_ANSWER = 5000

const buttonClass =
  'min-h-tap rounded-lg px-3.5 py-1.5 text-sm font-semibold transition disabled:opacity-60 sm:min-h-0'

/**
 * Taking and answering a sheet (OOC-58). The answer asks for a confirmation
 * first: it is e-mailed to the consumer the moment it is saved, and a sheet is
 * answered once — there is no editing it afterwards.
 */
export function ComplaintActions({
  complaintId,
  taken,
  email,
  language,
}: {
  complaintId: string
  taken: boolean
  email: string
  /** The language of the form, already named — the answer goes out in it. */
  language: string
}) {
  const t = useTranslations('bo')
  const router = useRouter()
  const [answer, setAnswer] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState<'take' | 'answer' | null>(null)
  const [error, setError] = useState<Exclude<ComplaintStepResult, 'done'> | null>(null)

  const trimmed = answer.trim()

  async function run(kind: 'take' | 'answer') {
    setBusy(kind)
    setError(null)
    const result = kind === 'take' ? await takeComplaint(complaintId) : await answerComplaint(complaintId, trimmed)
    setBusy(null)
    setConfirming(false)
    // Taken or answered by somebody else meanwhile: the page is stale, read it again.
    if (result === 'done' || result === 'already_taken' || result === 'already_answered') router.refresh()
    if (result !== 'done') setError(result)
  }

  return (
    <div className="flex flex-col gap-4">
      {!taken && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void run('take')}
            className={`${buttonClass} border border-line bg-white text-ink hover:border-brand-blue`}
          >
            {busy === 'take' ? t('complaints.taking') : t('complaints.take')}
          </button>
          <HelpHint what={t('help.complaint_take_what')} how={t('help.complaint_take_how')} />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5">
          <label htmlFor="complaint-answer" className="text-sm font-semibold text-ink">
            {t('complaints.answer_label')}
          </label>
          <HelpHint what={t('help.complaint_answer_what')} how={t('help.complaint_answer_how')} />
        </span>
        <textarea
          id="complaint-answer"
          rows={6}
          maxLength={MAX_ANSWER}
          value={answer}
          onChange={(event) => {
            setAnswer(event.target.value)
            setConfirming(false)
          }}
          placeholder={t('complaints.answer_placeholder')}
          className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-brand-blue"
        />
        <span className="self-end text-xs tabular-nums text-muted-foreground">
          {t('complaints.answer_counter', { count: answer.length, max: MAX_ANSWER })}
        </span>
      </div>

      {confirming ? (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-ink">{t('complaints.answer_confirm_title')}</p>
          <p className="text-sm text-ink">{t('complaints.answer_confirm_body', { email, language })}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run('answer')}
              className={`${buttonClass} w-full bg-brand-blue text-white hover:bg-brand-blue-deep sm:w-auto`}
            >
              {busy === 'answer' ? t('complaints.sending') : t('complaints.answer_confirm')}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setConfirming(false)}
              className={`${buttonClass} w-full border border-line bg-white text-ink sm:w-auto`}
            >
              {t('complaints.answer_cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={trimmed.length === 0 || busy !== null}
          onClick={() => setConfirming(true)}
          className={`${buttonClass} w-full bg-brand-blue text-white hover:bg-brand-blue-deep sm:w-fit`}
        >
          {t('complaints.answer_send')}
        </button>
      )}

      {error && (
        <p role="alert" className="text-sm font-semibold text-red-700">
          {t(`complaints.errors.${error}`)}
        </p>
      )}
    </div>
  )
}
