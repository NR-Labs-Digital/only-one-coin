'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  PASSWORD_MIN_LENGTH,
  canSubmitPassword,
  passwordRules,
  type PasswordDraft,
} from '@/lib/backoffice/account'
import { formatDate, type Locale } from '@/lib/format'
import { SectionTitle } from '@/components/backoffice/ui'
import { Toast } from '@/components/backoffice/controls'
import { BoIcon } from '@/components/backoffice/icons'

const EMPTY: PasswordDraft = { current: '', next: '', confirm: '' }

const fieldClass =
  'rounded-lg border border-line bg-white px-3 py-2 pr-10 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'
const labelClass =
  'flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground'

/**
 * Changing one's own password. The requirements are listed while the field is
 * being typed into, not thrown back after a failed save — the reader should
 * never learn the rule from a rejection.
 *
 * `POST /api/v1/me/password` (ChangeOwnPasswordUseCase) is where the rules
 * count: it re-checks the current password, applies the same requirements,
 * closes every other open session and writes the audit log (CLAUDE.md §8).
 */
export function AccountPassword({
  updatedAt,
  locale,
}: {
  updatedAt: string | null
  locale: Locale
}) {
  const t = useTranslations('bo')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<PasswordDraft>(EMPTY)
  const [reveal, setReveal] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<'current_incorrect' | 'failed' | null>(null)
  const [changedAt, setChangedAt] = useState(updatedAt)
  const [toast, setToast] = useState<string | null>(null)

  const rules = passwordRules(draft)
  const ready = canSubmitPassword(draft)

  function set<K extends keyof PasswordDraft>(key: K, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }))
    setError(null)
  }

  function close() {
    setOpen(false)
    setDraft(EMPTY)
    setReveal(false)
    setError(null)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready || pending) return
    setPending(true)
    try {
      const response = await fetch('/api/v1/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: draft.current, newPassword: draft.next }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { reason?: string } | null
        setError(body?.reason === 'staff_password.current_incorrect' ? 'current_incorrect' : 'failed')
        return
      }
      const result = (await response.json()) as { changedAt: string }
      setChangedAt(result.changedAt)
      close()
      setToast(t('account.password_saved_toast'))
    } catch {
      setError('failed')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="flex flex-col p-5">
      <SectionTitle icon="shield">{t('account.password_title')}</SectionTitle>

      <p className="mt-3 text-sm text-muted-foreground">
        {changedAt
          ? t('account.password_updated', { date: formatDate(changedAt, locale) })
          : t('account.password_never')}
      </p>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-brand-blue transition hover:border-brand-yellow hover:bg-cream hover:text-ink"
        >
          <BoIcon name="edit" size={16} />
          {t('account.password_change')}
        </button>
      ) : (
        // A password field is short by nature — running it the full width of a
        // page-wide card only makes it harder to read what was typed.
        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="mt-4 flex max-w-md flex-col gap-3"
          noValidate
        >
          <label className={labelClass}>
            {t('account.password_current_label')}
            <span className="relative">
              <input
                type={reveal ? 'text' : 'password'}
                autoComplete="current-password"
                className={`${fieldClass} w-full`}
                value={draft.current}
                onChange={(event) => set('current', event.target.value)}
                aria-invalid={error === 'current_incorrect'}
                aria-describedby={error === 'current_incorrect' ? 'password-current-error' : undefined}
                required
              />
              <RevealButton
                revealed={reveal}
                onToggle={() => setReveal((prev) => !prev)}
                label={reveal ? t('account.password_hide') : t('account.password_show')}
              />
            </span>
          </label>
          {/* Outside the label on purpose: inside it, the error would become
              part of the field's accessible name (same as the role dialog). */}
          {error === 'current_incorrect' && (
            <p
              id="password-current-error"
              role="alert"
              className="-mt-2 text-xs font-semibold text-red-600"
            >
              {t('account.password_current_wrong')}
            </p>
          )}

          <label className={labelClass}>
            {t('account.password_new_label')}
            <input
              type={reveal ? 'text' : 'password'}
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              className={`${fieldClass} w-full`}
              value={draft.next}
              onChange={(event) => set('next', event.target.value)}
              required
            />
          </label>

          <label className={labelClass}>
            {t('account.password_confirm_label')}
            <input
              type={reveal ? 'text' : 'password'}
              autoComplete="new-password"
              className={`${fieldClass} w-full`}
              value={draft.confirm}
              onChange={(event) => set('confirm', event.target.value)}
              required
            />
          </label>

          <ul className="flex flex-col gap-1 rounded-lg bg-sky-soft px-3 py-2.5">
            {rules.map((rule) => (
              <li
                key={rule.key}
                className={`flex items-center gap-2 text-xs ${
                  rule.met ? 'text-emerald-700' : 'text-muted-foreground'
                }`}
              >
                <BoIcon
                  name={rule.met ? 'check' : 'chevron-right'}
                  size={14}
                  className="shrink-0"
                />
                {t(`account.password_rule_${rule.key}`, {
                  min: PASSWORD_MIN_LENGTH,
                })}
              </li>
            ))}
          </ul>

          <p className="text-xs text-muted-foreground">{t('account.password_sessions_note')}</p>

          {error === 'failed' && (
            <p role="alert" className="text-xs font-semibold text-red-600">
              {t('account.password_failed')}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={!ready || pending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-yellow hover:text-ink active:bg-brand-yellow-deep disabled:cursor-not-allowed disabled:opacity-40"
            >
              <BoIcon name="check" size={16} />
              {pending ? t('account.password_saving') : t('account.password_save')}
            </button>
            <button
              type="button"
              onClick={close}
              disabled={pending}
              className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('account.cancel')}
            </button>
          </div>
        </form>
      )}

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </section>
  )
}

/** Eye toggle inside the current-password field — named, never drawn only. */
function RevealButton({
  revealed,
  onToggle,
  label,
}: {
  revealed: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      aria-pressed={revealed}
      className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition hover:bg-sky hover:text-ink"
    >
      <BoIcon name={revealed ? 'eye-off' : 'eye'} size={16} />
    </button>
  )
}
