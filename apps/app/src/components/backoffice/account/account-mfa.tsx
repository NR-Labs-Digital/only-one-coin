'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { SectionTitle, StatusBadge } from '@/components/backoffice/ui'
import { Toast } from '@/components/backoffice/controls'
import { BoIcon } from '@/components/backoffice/icons'
import { RecoveryCodes } from '@/components/backoffice/recovery-codes'
import {
  confirmEnrollment,
  disableMfa,
  regenerateRecoveryCodes,
  startEnrollment,
  type MfaCodeError,
  type OwnMfa,
} from '@/lib/backoffice/mfa'

type Mode = 'idle' | 'enroll' | 'codes' | 'regenerate' | 'disable'

const fieldClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'
const labelClass =
  'flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground'
const primaryClass =
  'inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-yellow hover:text-ink active:bg-brand-yellow-deep disabled:cursor-not-allowed disabled:opacity-40'
const secondaryClass =
  'inline-flex w-fit items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-brand-blue transition hover:border-brand-yellow hover:bg-cream hover:text-ink disabled:cursor-not-allowed disabled:opacity-40'
const cancelClass =
  'rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40'

/**
 * The account's own second factor (OOC-29) — an e-mailed code at every
 * sign-in. Turning it on proves the inbox with a code and shows the recovery
 * codes once; re-issuing them and turning the factor off ask for the password
 * again.
 *
 * For master, admin and billing it is mandatory (CLAUDE.md §8): the panel
 * never offers them the switch, and `POST /api/v1/me/mfa/disable` refuses it
 * anyway — the button missing here is the courtesy, the refusal is the rule.
 * Those cargos never reach this screen with it off: apps/api sends them to
 * the login's enrollment step first.
 */
export function AccountMfa({ initial, email }: { initial: OwnMfa | null; email: string }) {
  const t = useTranslations('bo')
  const tLogin = useTranslations('backoffice')
  const locale = useLocale()
  const [mfa, setMfa] = useState(initial)
  const [mode, setMode] = useState<Mode>('idle')
  const [pending, setPending] = useState(false)
  const [codeError, setCodeError] = useState<MfaCodeError | null>(null)
  const [error, setError] = useState<'password_incorrect' | 'failed' | null>(null)
  const [codes, setCodes] = useState<string[]>([])
  const [toast, setToast] = useState<string | null>(null)

  function reset() {
    setMode('idle')
    setCodeError(null)
    setError(null)
  }

  async function beginEnrollment() {
    setPending(true)
    setCodeError(null)
    setError(null)
    const result = await startEnrollment(locale)
    setPending(false)
    if (!result.ok) {
      setError('failed')
      return
    }
    setMode('enroll')
  }

  async function onConfirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const code = String(new FormData(event.currentTarget).get('code') ?? '').trim()
    setPending(true)
    setCodeError(null)
    const result = await confirmEnrollment(code)
    setPending(false)
    if (!result.ok) {
      setCodeError(result.error)
      return
    }
    setMfa((prev) => (prev ? { ...prev, enabled: true, recoveryCodesLeft: result.value.length } : prev))
    setCodes(result.value)
    setMode('codes')
  }

  async function onPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const password = String(new FormData(event.currentTarget).get('password') ?? '')
    setPending(true)
    setError(null)

    if (mode === 'regenerate') {
      const result = await regenerateRecoveryCodes(password)
      setPending(false)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setMfa((prev) => (prev ? { ...prev, recoveryCodesLeft: result.value.length } : prev))
      setCodes(result.value)
      setMode('codes')
      return
    }

    const result = await disableMfa(password)
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setMfa((prev) => (prev ? { ...prev, enabled: false, recoveryCodesLeft: 0 } : prev))
    reset()
    setToast(t('account.mfa_disabled_toast'))
  }

  if (!mfa) {
    return (
      <section className="flex flex-col p-5">
        <SectionTitle icon="key">{t('account.mfa_title')}</SectionTitle>
        <p className="mt-3 text-sm text-muted-foreground">{t('account.mfa_unavailable')}</p>
      </section>
    )
  }

  return (
    <section className="flex flex-col p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle icon="key">{t('account.mfa_title')}</SectionTitle>
        <StatusBadge
          tone={mfa.enabled ? 'success' : 'neutral'}
          label={mfa.enabled ? t('account.mfa_badge_on') : t('account.mfa_badge_off')}
        />
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        {mfa.enabled ? t('account.mfa_on') : t('account.mfa_off')}
      </p>

      {mfa.required && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-sky-soft px-3 py-2 text-xs text-muted-foreground">
          <BoIcon name="shield" size={14} className="mt-0.5 shrink-0" />
          {t('account.mfa_required_note')}
        </p>
      )}

      {mfa.enabled && mode !== 'codes' && (
        <p
          className={`mt-3 text-sm ${mfa.recoveryCodesLeft <= 2 ? 'font-semibold text-amber-700' : 'text-muted-foreground'}`}
        >
          {t('account.mfa_codes_left', { count: mfa.recoveryCodesLeft })}
        </p>
      )}

      {mode === 'idle' && (
        <div className="mt-4 flex flex-wrap gap-2">
          {!mfa.enabled && (
            <button type="button" onClick={() => void beginEnrollment()} disabled={pending} className={secondaryClass}>
              <BoIcon name="shield" size={16} />
              {pending ? t('account.mfa_sending') : t('account.mfa_enable')}
            </button>
          )}
          {mfa.enabled && (
            <button type="button" onClick={() => setMode('regenerate')} className={secondaryClass}>
              <BoIcon name="key" size={16} />
              {t('account.mfa_regenerate')}
            </button>
          )}
          {mfa.enabled && !mfa.required && (
            <button type="button" onClick={() => setMode('disable')} className={cancelClass}>
              {t('account.mfa_disable')}
            </button>
          )}
        </div>
      )}

      {mode === 'idle' && error === 'failed' && (
        <p role="alert" className="mt-3 text-xs font-semibold text-red-600">
          {t('account.mfa_failed')}
        </p>
      )}

      {mode === 'enroll' && (
        <form onSubmit={(event) => void onConfirm(event)} className="mt-4 flex max-w-md flex-col gap-3" noValidate>
          <p className="text-sm text-ink">{t('account.mfa_code_sent', { email })}</p>
          <label className={labelClass}>
            {t('account.mfa_code_label')}
            <input
              type="text"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              required
              autoFocus
              placeholder="000000"
              className={`${fieldClass} w-full text-center text-lg font-semibold tracking-[0.4em]`}
            />
          </label>
          {codeError && (
            <p role="alert" className="text-xs font-semibold text-red-600">
              {tLogin(`mfa_error_${codeError}`)}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={pending} className={primaryClass}>
              <BoIcon name="check" size={16} />
              {pending ? t('account.mfa_confirming') : t('account.mfa_confirm')}
            </button>
            <button type="button" onClick={() => void beginEnrollment()} disabled={pending} className={cancelClass}>
              {tLogin('mfa_resend')}
            </button>
            <button type="button" onClick={reset} disabled={pending} className={cancelClass}>
              {t('account.cancel')}
            </button>
          </div>
        </form>
      )}

      {(mode === 'regenerate' || mode === 'disable') && (
        <form onSubmit={(event) => void onPassword(event)} className="mt-4 flex max-w-md flex-col gap-3" noValidate>
          <p className="text-sm text-ink">
            {mode === 'regenerate' ? t('account.mfa_regenerate_note') : t('account.mfa_disable_note')}
          </p>
          <label className={labelClass}>
            {t('account.mfa_password_label')}
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              autoFocus
              className={`${fieldClass} w-full`}
              aria-invalid={error === 'password_incorrect'}
            />
          </label>
          {error && (
            <p role="alert" className="text-xs font-semibold text-red-600">
              {error === 'password_incorrect' ? t('account.password_current_wrong') : t('account.mfa_failed')}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button type="submit" disabled={pending} className={primaryClass}>
              <BoIcon name="check" size={16} />
              {mode === 'regenerate' ? t('account.mfa_regenerate') : t('account.mfa_disable')}
            </button>
            <button type="button" onClick={reset} disabled={pending} className={cancelClass}>
              {t('account.cancel')}
            </button>
          </div>
        </form>
      )}

      {mode === 'codes' && (
        <div className="mt-4 max-w-md">
          <RecoveryCodes
            codes={codes}
            doneLabel={t('account.mfa_codes_done')}
            onDone={() => {
              setCodes([])
              reset()
              setToast(t('account.mfa_saved_toast'))
            }}
          />
        </div>
      )}

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </section>
  )
}
