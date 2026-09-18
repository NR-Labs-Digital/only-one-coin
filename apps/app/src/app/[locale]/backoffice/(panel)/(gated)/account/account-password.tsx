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
 * Frontend stub: nothing leaves the browser. The real change is a usecase in
 * `apps/api` that re-checks the current password server-side and writes to the
 * append-only audit log (CLAUDE.md §8).
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
  const [toast, setToast] = useState<string | null>(null)

  const rules = passwordRules(draft)
  const ready = canSubmitPassword(draft)

  function set<K extends keyof PasswordDraft>(key: K, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  function close() {
    setOpen(false)
    setDraft(EMPTY)
    setReveal(false)
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready || pending) return
    // Mock only: fake the round-trip so the pending state is exercisable.
    setPending(true)
    window.setTimeout(() => {
      setPending(false)
      close()
      setToast(t('account.password_saved_toast'))
    }, 500)
  }

  return (
    <section className="flex flex-col p-5">
      <SectionTitle icon="shield">{t('account.password_title')}</SectionTitle>

      <p className="mt-3 text-sm text-muted-foreground">
        {updatedAt
          ? t('account.password_updated', { date: formatDate(updatedAt, locale) })
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
          onSubmit={handleSubmit}
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
                required
              />
              <RevealButton
                revealed={reveal}
                onToggle={() => setReveal((prev) => !prev)}
                label={reveal ? t('account.password_hide') : t('account.password_show')}
              />
            </span>
          </label>

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
