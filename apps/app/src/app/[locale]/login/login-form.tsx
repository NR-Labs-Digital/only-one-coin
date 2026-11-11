'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { signInStudent, type NationalIdType, type SignInMethod } from '@/lib/portal/auth-client'
import { fetchPreferredLocale } from '@/lib/preferred-locale'
import { EyeIcon, EyeOffIcon, LockIcon } from './icons'
import { IdentifierFields, adornClass, fieldClass } from './identifier-fields'

/**
 * Sign-in against the real API. Anti-enumeration (`CLAUDE.md` §8): one banner
 * for a wrong password, an unknown account and a malformed document alike —
 * the API answers all of them with the same 401, and the screen adds nothing.
 * The document type travels with the number (the same number can exist under
 * two types). The session cookie is set through the same-origin proxy, so it
 * lands on this origin. Nothing typed here is ever logged: the identifier is
 * PII (§6).
 */
export function LoginForm() {
  const t = useTranslations('login')
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<{ errorId: string | null } | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [method, setMethod] = useState<SignInMethod>('email')
  const [nationalIdType, setNationalIdType] = useState<NationalIdType>('DNI')

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setFailure(null)
    setPending(true)

    const form = new FormData(event.currentTarget)
    const result = await signInStudent({
      method,
      identifier: String(form.get('identifier') ?? ''),
      nationalIdType: method === 'national_id' ? nationalIdType : undefined,
      password: String(form.get('password') ?? ''),
    })

    if (!result.ok) {
      setPending(false)
      setFailure({ errorId: result.errorId })
      return
    }
    // The language chosen on the profile (OOC-150) opens the portal; none
    // saved, it stays in the language of this page.
    const saved = await fetchPreferredLocale('student')
    router.push('/portal', saved ? { locale: saved } : undefined)
    router.refresh()
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="rounded-[28px] border border-line bg-white p-6 shadow-float sm:p-7"
      noValidate
    >
      <h1 className="font-display text-3xl font-semibold leading-tight text-ink">
        {t('title')}
      </h1>
      <p className="mt-2 mb-5 text-sm leading-relaxed text-muted-foreground">
        {t('subtitle')}
      </p>

      {failure && (
        <div
          role="alert"
          className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <p>{t('generic_error')}</p>
          {failure.errorId && (
            <p className="mt-1 text-xs text-red-500">
              {t('error_reference', { errorId: failure.errorId })}
            </p>
          )}
        </div>
      )}

      <IdentifierFields
        method={method}
        onMethodChange={setMethod}
        nationalIdType={nationalIdType}
        onNationalIdTypeChange={setNationalIdType}
      />

      <div className="mt-5 flex flex-col gap-5">
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink">
          {t('password_label')}
          <span className="relative flex items-center">
            <input
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
              required
              placeholder={t('password_placeholder')}
              className={`${fieldClass} pr-12`}
            />
            <LockIcon size={18} className={adornClass} />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? t('hide_password') : t('show_password')}
              className="absolute right-3 grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition hover:bg-sky hover:text-ink"
            >
              {showPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
            </button>
          </span>
        </label>
      </div>

      <p className="mt-3 text-right text-sm">
        <Link href="/forgot-password" className="font-semibold text-brand-blue transition hover:text-brand-blue-deep">
          {t('forgot_password')}
        </Link>
      </p>

      {/* Azul → amarelo no hover: o mesmo gesto do `.btn-primary` da landing. */}
      <button
        type="submit"
        disabled={pending}
        className="mt-6 flex w-full items-center justify-center rounded-full bg-brand-blue px-4 py-3.5 text-sm font-bold text-white shadow-[0_18px_34px_-16px_rgba(47,107,255,0.95)] transition hover:-translate-y-0.5 hover:bg-brand-yellow hover:text-ink hover:shadow-[0_20px_38px_-16px_rgba(245,166,35,0.9)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
      >
        {pending ? t('submitting') : t('submit')}
      </button>
    </form>
  )
}
