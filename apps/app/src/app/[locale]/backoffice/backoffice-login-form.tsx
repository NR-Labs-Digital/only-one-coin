'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { RecoveryCodes } from '@/components/backoffice/recovery-codes'
import {
  EMAIL_LOCALE,
  confirmEnrollment,
  getOwnMfa,
  sendSignInCode,
  startEnrollment,
  verifyRecoveryCode,
  verifySignInCode,
  type MfaCodeError,
  type MfaResult,
} from '@/lib/backoffice/mfa'
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  MailIcon,
} from './icons'

type Step =
  | 'credentials'
  /** Better Auth withheld the session: the e-mailed code trades for it. */
  | 'mfa'
  /** Same challenge, answered with a recovery code instead. */
  | 'mfa_recovery'
  /** A cargo that must have the factor, signed in without it: turn it on now. */
  | 'mfa_setup'
  /** Just turned on — the recovery codes, shown once. */
  | 'recovery_codes'
  | 'recover'
  | 'recover_sent'

/** What the page can open on, from `?mfa=` (see page.tsx). */
export type InitialLoginStep = 'mfa' | 'mfa_setup'

/** Seconds before "send another code" works again — the e-mail takes a few to arrive. */
const RESEND_COOLDOWN_SECONDS = 30

const HOME = '/backoffice/home'

function Heading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  )
}

/**
 * Backoffice login. Credentials go straight to Better Auth's own
 * `/api/auth/sign-in/email` — same-origin, through the proxy every other
 * `apps/api` route goes through (`docs/ARCHITECTURE.md` §5.6) — so the
 * session cookie it sets lands on this origin without a cross-origin hop.
 *
 * Second factor (OOC-29), by e-mailed code — two ways the password is not the
 * end of it:
 *
 * - The account has it on: Better Auth opens no session and answers
 *   `twoFactorRedirect`. The `mfa` step e-mails the code and trades it for the
 *   session; a recovery code works in its place.
 * - The account's cargo requires it (master, admin, billing — CLAUDE.md §8)
 *   and it is not on yet: the password opens a session that apps/api refuses
 *   everywhere but the enrollment routes. The `mfa_setup` step turns it on
 *   with a code, then shows the recovery codes once.
 *
 * Neither is the enforcement — apps/api is. This screen only walks the person
 * through what apps/api will demand anyway.
 *
 * The failure banner is deliberately the same whether the address doesn't
 * exist or the password is wrong (CLAUDE.md §8, anti-enumeration).
 *
 * Password recovery lives here as a step instead of its own route so the
 * anti-enumeration answer is structural: the confirmation screen is identical
 * whether or not the address exists (CLAUDE.md §8). It asks
 * `POST /staff/password-resets/request` (OOC-30), which answers 202 either
 * way and e-mails the link to the account, if there is one, in this screen's
 * language. Only a request that never got that answer — network, 5xx — shows
 * an error.
 */
export function BackofficeLoginForm({ initialStep }: { initialStep?: InitialLoginStep }) {
  const t = useTranslations('backoffice')
  const locale = useLocale()
  const router = useRouter()
  const [step, setStep] = useState<Step>(initialStep ?? 'credentials')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<'credentials' | 'challenge_expired' | null>(null)
  const [codeError, setCodeError] = useState<MfaCodeError | null>(null)
  const [codeSent, setCodeSent] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [recoverError, setRecoverError] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const opened = useRef(false)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((prev) => prev - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  // Landing straight on a code step (from the password reset, or sent here by
  // the panel) mails the code once. The ref keeps a dev-mode double effect
  // from mailing two.
  useEffect(() => {
    if (opened.current || !initialStep) return
    opened.current = true
    void (initialStep === 'mfa' ? sendCode('mfa') : sendCode('mfa_setup'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function resetCodeState() {
    setCodeError(null)
    setCodeSent(false)
  }

  /** Mails a code for the step — the sign-in challenge or the enrollment. */
  async function sendCode(target: 'mfa' | 'mfa_setup') {
    setCodeError(null)
    const result = target === 'mfa' ? await sendSignInCode(locale) : await startEnrollment(locale)
    if (!result.ok) {
      handleCodeError(result.error)
      return
    }
    setCodeSent(true)
    setCooldown(RESEND_COOLDOWN_SECONDS)
  }

  function handleCodeError(kind: MfaCodeError) {
    if (kind === 'challenge_expired') {
      // The challenge cookie lasts 10 minutes; past that only the password restarts it.
      resetCodeState()
      setError('challenge_expired')
      setStep('credentials')
      return
    }
    setCodeError(kind)
  }

  async function onCredentials(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    setError(null)
    setPending(true)

    const formData = new FormData(event.currentTarget)
    let response: Response | null = null
    try {
      response = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.get('email'),
          password: formData.get('password'),
        }),
      })
    } catch {
      response = null
    }

    if (!response?.ok) {
      setPending(false)
      setError('credentials')
      return
    }

    const body = (await response.json().catch(() => null)) as { twoFactorRedirect?: boolean } | null
    if (body?.twoFactorRedirect) {
      resetCodeState()
      setStep('mfa')
      setPending(false)
      await sendCode('mfa')
      return
    }

    // A session exists. A cargo that must have the factor and does not yet is
    // refused by apps/api everywhere — turn it on here instead of bouncing.
    const mfa = await getOwnMfa()
    setPending(false)
    if (mfa?.required && !mfa.enabled) {
      resetCodeState()
      setStep('mfa_setup')
      await sendCode('mfa_setup')
      return
    }

    router.push(HOME)
  }

  async function submitCode(
    event: React.FormEvent<HTMLFormElement>,
    verify: (code: string) => Promise<MfaResult<unknown>>,
    onOk: (value: unknown) => void,
  ) {
    event.preventDefault()
    if (pending) return
    const code = String(new FormData(event.currentTarget).get('code') ?? '').trim()
    if (!code) return

    setPending(true)
    setCodeError(null)
    const result = await verify(code)
    setPending(false)

    if (!result.ok) {
      handleCodeError(result.error)
      return
    }
    onOk(result.value)
  }

  async function onRecover(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    setRecoverError(false)
    setPending(true)

    const formData = new FormData(event.currentTarget)
    let ok = false
    try {
      const response = await fetch('/api/v1/staff/password-resets/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.get('email'),
          locale: EMAIL_LOCALE[locale] ?? 'es-PE',
        }),
      })
      ok = response.ok
    } catch {
      ok = false
    }

    setPending(false)

    if (!ok) {
      setRecoverError(true)
      return
    }

    setStep('recover_sent')
  }

  /** Leaving the forced enrollment means leaving: the half-session it holds opens nothing. */
  async function signOutOfSetup() {
    await fetch('/api/auth/sign-out', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => null)
    resetCodeState()
    setStep('credentials')
  }

  const cardClass =
    'rounded-3xl border border-line bg-white p-7 shadow-float sm:p-8'
  const labelClass = 'flex flex-col gap-1.5 text-sm font-semibold text-ink'
  const fieldWrapClass = 'relative flex items-center'
  const fieldClass =
    'w-full rounded-xl border border-line bg-sky-soft py-2.5 pl-10 pr-3 text-base font-normal text-ink outline-none transition placeholder:text-slate-500 focus:border-brand-blue focus:bg-white focus:ring-4 focus:ring-brand-blue/12'
  const codeFieldClass =
    'w-full rounded-xl border border-line bg-sky-soft px-3 py-3 text-center text-xl font-semibold tracking-[0.5em] text-ink outline-none transition placeholder:text-slate-400 focus:border-brand-blue focus:bg-white focus:ring-4 focus:ring-brand-blue/12'
  const adornClass =
    'pointer-events-none absolute left-3 text-slate-400 peer-focus:text-brand-blue'
  const primaryButtonClass =
    'mt-1 flex w-full items-center justify-center gap-2 rounded-full bg-brand-blue px-4 py-3 text-sm font-bold text-white shadow-[0_16px_30px_-14px_rgba(47,107,255,0.9)] transition hover:bg-brand-yellow hover:text-ink disabled:cursor-not-allowed disabled:opacity-60'
  const ghostButtonClass =
    'flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-muted-foreground transition hover:bg-cream hover:text-ink disabled:opacity-60'
  const linkButtonClass =
    'text-xs font-semibold text-brand-blue transition hover:text-brand-blue-deep hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline'

  const codeFeedback = (
    <>
      {codeError && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {t(`mfa_error_${codeError}`)}
        </div>
      )}
      {!codeError && codeSent && (
        <div
          role="status"
          className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {t('mfa_sent')}
        </div>
      )}
    </>
  )

  const emailCodeField = (
    <label className={labelClass}>
      {t('mfa_code_label')}
      <input
        type="text"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        required
        autoFocus
        placeholder={t('mfa_code_placeholder')}
        className={codeFieldClass}
      />
    </label>
  )

  const resendButton = (target: 'mfa' | 'mfa_setup') => (
    <button
      type="button"
      onClick={() => void sendCode(target)}
      disabled={pending || cooldown > 0}
      className={linkButtonClass}
    >
      {cooldown > 0 ? t('mfa_resend_wait', { seconds: cooldown }) : t('mfa_resend')}
    </button>
  )

  if (step === 'recover_sent') {
    return (
      <div className={cardClass}>
        <div className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600">
          <CheckCircleIcon size={24} />
        </div>
        <Heading title={t('recover_sent_title')} subtitle={t('recover_sent_body')} />
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setStep('credentials')}
            className={ghostButtonClass}
          >
            <ArrowLeftIcon size={16} />
            {t('back_to_login')}
          </button>
        </div>
      </div>
    )
  }

  if (step === 'recover') {
    return (
      <form onSubmit={(event) => void onRecover(event)} className={cardClass} noValidate>
        <Heading title={t('recover_title')} subtitle={t('recover_subtitle')} />

        {recoverError && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {t('recover_error')}
          </div>
        )}

        <label className={labelClass}>
          {t('email_label')}
          <span className={fieldWrapClass}>
            <input
              type="email"
              name="email"
              autoComplete="username"
              required
              placeholder={t('email_placeholder')}
              className={`peer ${fieldClass}`}
            />
            <MailIcon size={18} className={adornClass} />
          </span>
        </label>

        <button type="submit" disabled={pending} className={`${primaryButtonClass} mt-5`}>
          {pending ? t('recover_sending') : t('recover_submit')}
        </button>

        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => setStep('credentials')}
            disabled={pending}
            className={ghostButtonClass}
          >
            <ArrowLeftIcon size={16} />
            {t('back_to_login')}
          </button>
        </div>
      </form>
    )
  }

  if (step === 'recovery_codes') {
    return (
      <div className={cardClass}>
        <Heading title={t('recovery_codes_title')} subtitle={t('mfa_setup_done_subtitle')} />
        <RecoveryCodes
          codes={recoveryCodes}
          doneLabel={t('mfa_setup_done')}
          onDone={() => router.push(HOME)}
        />
      </div>
    )
  }

  if (step === 'mfa_setup') {
    return (
      <form
        onSubmit={(event) =>
          void submitCode(event, confirmEnrollment, (codes) => {
            setRecoveryCodes(codes as string[])
            setStep('recovery_codes')
          })
        }
        className={cardClass}
        noValidate
      >
        <Heading title={t('mfa_setup_title')} subtitle={t('mfa_setup_subtitle')} />
        {codeFeedback}
        {emailCodeField}

        <div className="mt-2 flex justify-end">{resendButton('mfa_setup')}</div>

        <button type="submit" disabled={pending} className={`${primaryButtonClass} mt-4`}>
          {pending ? t('verifying') : t('mfa_setup_submit')}
        </button>

        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => void signOutOfSetup()}
            disabled={pending}
            className={ghostButtonClass}
          >
            <ArrowLeftIcon size={16} />
            {t('mfa_setup_sign_out')}
          </button>
        </div>
      </form>
    )
  }

  if (step === 'mfa_recovery') {
    return (
      <form
        onSubmit={(event) => void submitCode(event, verifyRecoveryCode, () => router.push(HOME))}
        className={cardClass}
        noValidate
      >
        <Heading title={t('mfa_recovery_title')} subtitle={t('mfa_recovery_subtitle')} />
        {codeError && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {t(codeError === 'invalid' ? 'mfa_error_recovery_invalid' : `mfa_error_${codeError}`)}
          </div>
        )}

        <label className={labelClass}>
          {t('mfa_recovery_label')}
          <input
            type="text"
            name="code"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={11}
            required
            autoFocus
            placeholder={t('mfa_recovery_placeholder')}
            className={`${codeFieldClass} font-mono tracking-[0.2em]`}
          />
        </label>

        <button type="submit" disabled={pending} className={`${primaryButtonClass} mt-5`}>
          {pending ? t('verifying') : t('verify')}
        </button>

        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => {
              setCodeError(null)
              setStep('mfa')
            }}
            disabled={pending}
            className={ghostButtonClass}
          >
            <ArrowLeftIcon size={16} />
            {t('mfa_use_email')}
          </button>
        </div>
      </form>
    )
  }

  if (step === 'mfa') {
    return (
      <form
        onSubmit={(event) => void submitCode(event, verifySignInCode, () => router.push(HOME))}
        className={cardClass}
        noValidate
      >
        <Heading title={t('mfa_title')} subtitle={t('mfa_subtitle')} />
        {codeFeedback}
        {emailCodeField}

        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              setCodeError(null)
              setStep('mfa_recovery')
            }}
            className={linkButtonClass}
          >
            {t('mfa_use_recovery')}
          </button>
          {resendButton('mfa')}
        </div>

        <button type="submit" disabled={pending} className={`${primaryButtonClass} mt-4`}>
          {pending ? t('verifying') : t('verify')}
        </button>

        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => {
              resetCodeState()
              setStep('credentials')
            }}
            disabled={pending}
            className={ghostButtonClass}
          >
            <ArrowLeftIcon size={16} />
            {t('back')}
          </button>
        </div>
      </form>
    )
  }

  return (
    <form onSubmit={(event) => void onCredentials(event)} className={cardClass} noValidate>
      <Heading title={t('title')} subtitle={t('subtitle')} />

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error === 'credentials' ? t('generic_error') : t('mfa_error_challenge_expired')}
        </div>
      )}

      <div className="flex flex-col gap-4">
        <label className={labelClass}>
          {t('email_label')}
          <span className={fieldWrapClass}>
            <input
              type="email"
              name="email"
              autoComplete="username"
              required
              placeholder={t('email_placeholder')}
              className={`peer ${fieldClass}`}
            />
            <MailIcon size={18} className={adornClass} />
          </span>
        </label>

        <label className={labelClass}>
          <span className="flex items-center justify-between gap-2">
            {t('password_label')}
            <button
              type="button"
              onClick={() => setStep('recover')}
              className="text-xs font-semibold text-brand-blue transition hover:text-brand-blue-deep hover:underline"
            >
              {t('forgot_password')}
            </button>
          </span>
          <span className={fieldWrapClass}>
            <input
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
              required
              placeholder={t('password_placeholder')}
              className={`peer ${fieldClass} pr-11`}
            />
            <LockIcon size={18} className={adornClass} />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-pressed={showPassword}
              aria-label={showPassword ? t('hide_password') : t('show_password')}
              title={showPassword ? t('hide_password') : t('show_password')}
              className="absolute right-2 grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-cream hover:text-ink"
            >
              {showPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
            </button>
          </span>
        </label>
      </div>

      <button type="submit" disabled={pending} className={`${primaryButtonClass} mt-6`}>
        {pending ? t('checking') : t('continue')}
      </button>
    </form>
  )
}
