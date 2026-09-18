'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { addTestRecipient, MAX_TEST_RECIPIENTS } from '@/lib/backoffice/email-proof'
import { BoIcon } from '@/components/backoffice/icons'

/**
 * The proof send, shared by an automatic e-mail's page and the composer.
 *
 * Addresses go in one at a time and stay visible as chips. The comma-separated
 * line it replaced asked somebody to punctuate a list correctly under no
 * feedback — and a proof that quietly went to four of five addresses is worse
 * than one that refused to go at all.
 */
export function ProofSend({ onSent }: { onSent: (count: number) => void }) {
  const t = useTranslations('bo')

  const [list, setList] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  function add() {
    const added = addTestRecipient(draft, list)
    if (!added.ok) {
      if (added.reason === 'empty') setError(t('emails.test_error_empty'))
      else if (added.reason === 'invalid') setError(t('emails.test_error_invalid'))
      else if (added.reason === 'duplicate')
        setError(t('emails.test_error_duplicate'))
      else setError(t('emails.test_error_max', { max: MAX_TEST_RECIPIENTS }))
      return
    }
    setList([...list, added.value])
    setDraft('')
    setError(null)
  }

  function send() {
    if (list.length === 0) {
      setError(t('emails.test_error_none'))
      return
    }
    setError(null)
    setList([])
    onSent(list.length)
  }

  const full = list.length >= MAX_TEST_RECIPIENTS

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {t('emails.test_hint', {
          max: MAX_TEST_RECIPIENTS,
          prefix: t('emails.test_prefix'),
        })}
      </p>

      {list.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {list.map((address) => (
            <li
              key={address}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white py-1 pl-3 pr-1.5 text-xs font-medium text-ink"
            >
              {address}
              <button
                type="button"
                aria-label={t('emails.test_remove', { value: address })}
                onClick={() => {
                  setList(list.filter((item) => item !== address))
                  setError(null)
                }}
                className="grid size-5 place-items-center rounded-full text-muted-foreground transition hover:bg-cream hover:text-ink"
              >
                <BoIcon name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="min-w-52 flex-1">
          <span className="sr-only">{t('emails.test_label')}</span>
          <input
            type="email"
            value={draft}
            disabled={full}
            onChange={(event) => {
              setDraft(event.target.value)
              setError(null)
            }}
            onKeyDown={(event) => {
              /* Enter adds the address it is sitting on — nobody reaches for
                 the button after typing an e-mail. */
              if (event.key === 'Enter') {
                event.preventDefault()
                add()
              }
            }}
            placeholder={t('emails.test_placeholder')}
            aria-invalid={error !== null}
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15 disabled:bg-slate-50 disabled:text-muted-foreground"
          />
        </label>
        <button
          type="button"
          onClick={add}
          disabled={full}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-brand-blue transition hover:border-brand-yellow hover:bg-cream hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          <BoIcon name="plus" size={16} />
          {t('emails.test_add')}
        </button>
      </div>

      {error && <p className="text-xs font-medium text-red-600">{error}</p>}

      <button
        type="button"
        onClick={send}
        className="inline-flex items-center justify-center gap-1.5 self-start rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-yellow hover:text-ink active:bg-brand-yellow-deep"
      >
        <BoIcon name="email" size={16} />
        {t('emails.test_send')}
      </button>

      {/* The staging guard, said out loud: outside production the provider
          refuses anything off the allowlist (CLAUDE.md §6), so a proof that
          never arrives is the rule working. */}
      <p className="flex items-start gap-2 rounded-lg border border-dashed border-line bg-sky-soft px-3 py-2 text-xs text-muted-foreground">
        <BoIcon name="shield" size={14} className="mt-0.5 shrink-0" />
        {t('emails.test_guard')}
      </p>
    </div>
  )
}
