'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

/**
 * The recovery codes, shown once (OOC-29) — the platform keeps them encrypted
 * and never shows them again, so the screen does not let the person move on
 * before saying they kept them. Each code works once, in place of the e-mailed
 * code, for the day the inbox is out of reach.
 *
 * Shared by the sign-in flow (forced enrollment) and the account screen, so
 * its copy lives in the `backoffice` namespace both pages load.
 */
export function RecoveryCodes({
  codes,
  onDone,
  doneLabel,
}: {
  codes: string[]
  onDone: () => void
  doneLabel: string
}) {
  const t = useTranslations('backoffice')
  const [kept, setKept] = useState(false)
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  function download() {
    const text = `${t('recovery_codes_file_heading')}\n\n${codes.join('\n')}\n`
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'only-one-coin-recovery-codes.txt'
    link.click()
    URL.revokeObjectURL(url)
  }

  const secondaryClass =
    'inline-flex items-center justify-center rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink transition hover:border-brand-yellow hover:bg-cream'

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t('recovery_codes_body')}</p>

      <ul
        aria-label={t('recovery_codes_title')}
        className="grid grid-cols-2 gap-2 rounded-2xl border border-line bg-sky-soft p-4 font-mono text-sm text-ink"
      >
        {codes.map((code) => (
          <li key={code} className="text-center tracking-wider">
            {code}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void copy()} className={secondaryClass}>
          {copied ? t('recovery_codes_copied') : t('recovery_codes_copy')}
        </button>
        <button type="button" onClick={download} className={secondaryClass}>
          {t('recovery_codes_download')}
        </button>
      </div>

      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={kept}
          onChange={(event) => setKept(event.target.checked)}
          className="mt-0.5 size-4 accent-brand-blue"
        />
        {t('recovery_codes_kept')}
      </label>

      <button
        type="button"
        disabled={!kept}
        onClick={onDone}
        className="flex w-full items-center justify-center rounded-full bg-brand-blue px-4 py-3 text-sm font-bold text-white transition hover:bg-brand-yellow hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
      >
        {doneLabel}
      </button>
    </div>
  )
}
