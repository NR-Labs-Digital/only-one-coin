'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { PASSWORD_MIN_LENGTH } from '@/lib/backoffice/account'
import {
  CheckCircleIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  MailIcon,
} from '@/components/backoffice/auth-icons'

/**
 * The one thing this screen exists to collect: a new password nobody else
 * ever saw, for an account that already exists (`CLAUDE.md` §8, "a panel que
 * muestra la contraseña de otro es un panel que la tiene"). E-mail is
 * read-only — it came from the reset link, not a field somebody here could
 * edit into a different account.
 *
 * Posts to `POST /api/v1/staff/password-resets/complete` (same-origin proxy)
 * — `CompleteStaffPasswordResetUseCase` writes the new password. On success
 * this immediately signs the account in, same as
 * `invite-completion-form.tsx` does after creating one.
 */
export function PasswordResetForm({
  token,
  name,
  email,
}: {
  token: string
  name: string
  email: string
}) {
  const t = useTranslations('backoffice')
  const router = useRouter()
  const [step, setStep] = useState<'form' | 'done'>('form')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<'short' | 'mismatch' | 'server' | null>(null)

  const cardClass =
    'rounded-3xl border border-line bg-white p-7 shadow-float sm:p-8'
  const labelClass = 'flex flex-col gap-1.5 text-sm font-semibold text-ink'
  const fieldWrapClass = 'relative flex items-center'
  const fieldClass =
    'w-full rounded-xl border border-line bg-sky-soft py-2.5 pl-10 pr-3 text-base font-normal text-ink outline-none transition placeholder:text-slate-500 focus:border-brand-blue focus:bg-white focus:ring-4 focus:ring-brand-blue/12'
  const adornClass =
    'pointer-events-none absolute left-3 text-slate-400 peer-focus:text-brand-blue'
  const primaryButtonClass =
    'mt-1 flex w-full items-center justify-center gap-2 rounded-full bg-brand-blue px-4 py-3 text-sm font-bold text-white shadow-[0_16px_30px_-14px_rgba(47,107,255,0.9)] transition hover:bg-brand-yellow hover:text-ink disabled:cursor-not-allowed disabled:opacity-60'

  if (step === 'done') {
    return (
      <div className={cardClass}>
        <div className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600">
          <CheckCircleIcon size={24} />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {t('reset_done_title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('reset_done_body')}</p>
        <Link href="/backoffice" className={`${primaryButtonClass} mt-6`}>
          {t('reset_done_cta')}
        </Link>
      </div>
    )
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    if (
      password.length < PASSWORD_MIN_LENGTH ||
      !/\p{L}/u.test(password) ||
      !/\d/.test(password)
    ) {
      setError('short')
      return
    }
    if (password !== confirmPassword) {
      setError('mismatch')
      return
    }

    setError(null)
    setPending(true)

    try {
      const response = await fetch('/api/v1/staff/password-resets/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })

      if (!response.ok) {
        setError('server')
        return
      }

      const signIn = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (signIn.ok) {
        // With the second factor on, the password opens no session: Better
        // Auth answers `twoFactorRedirect` and the login screen asks the code.
        const body = (await signIn.json().catch(() => null)) as { twoFactorRedirect?: boolean } | null
        router.push(body?.twoFactorRedirect ? '/backoffice?mfa=challenge' : '/backoffice/home')
        return
      }

      // Password is set either way — the immediate sign-in is a convenience,
      // not the definition of success.
      setStep('done')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className={cardClass} noValidate>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {t('reset_title', { name })}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('reset_subtitle')}</p>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {t(
            error === 'short'
              ? 'invite_error_short'
              : error === 'mismatch'
                ? 'invite_error_mismatch'
                : 'invite_error_server',
            { min: PASSWORD_MIN_LENGTH },
          )}
        </div>
      )}

      <div className="flex flex-col gap-4">
        <label className={labelClass}>
          {t('invite_email_label')}
          <span className={fieldWrapClass}>
            <input
              type="email"
              value={email}
              readOnly
              disabled
              className={`${fieldClass} disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-muted-foreground`}
            />
            <MailIcon size={18} className={adornClass} />
          </span>
        </label>

        <label className={labelClass}>
          {t('invite_password_label')}
          <span className={fieldWrapClass}>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              required
              placeholder={t('invite_password_placeholder')}
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
          <span className="text-xs font-normal text-muted-foreground">
            {t('invite_password_hint', { min: PASSWORD_MIN_LENGTH })}
          </span>
        </label>

        <label className={labelClass}>
          {t('invite_confirm_label')}
          <span className={fieldWrapClass}>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              required
              placeholder={t('invite_confirm_placeholder')}
              className={`peer ${fieldClass}`}
            />
            <LockIcon size={18} className={adornClass} />
          </span>
        </label>
      </div>

      <button type="submit" disabled={pending} className={`${primaryButtonClass} mt-5`}>
        {pending ? t('reset_submitting') : t('reset_submit')}
      </button>
    </form>
  )
}
