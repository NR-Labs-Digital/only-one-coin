'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import type { ClassroomAccountList, ClassroomAccountRow } from '@/lib/backoffice/types'
import {
  createClassroomAccount,
  retireClassroomAccount,
  revealClassroomPassword,
  updateClassroomAccount,
  type ClassroomAccountFailure,
  type ClassroomCredentials,
} from '@/lib/backoffice/classroom-accounts-client'
import { formatDate, type Locale } from '@/lib/format'
import { Card, EmptyState, StatusBadge, TableShell, tdClass, thClass } from '@/components/backoffice/ui'
import { Toast } from '@/components/backoffice/controls'
import { BoIcon } from '@/components/backoffice/icons'
import { HelpHint } from '@/components/backoffice/help-hint'
import { FieldMessage } from '@/components/backoffice/field-message'
import { AutoGrid } from '@/components/layout/auto-grid'
import { ClassroomCredentialsCard } from '@/components/backoffice/teachers/classroom-credentials'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const fieldClass =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

const labelClass = 'text-xs font-medium uppercase tracking-wide text-muted-foreground'

const primaryClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:opacity-50'

const secondaryClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:bg-cream disabled:opacity-50'

function failureText(failure: ClassroomAccountFailure, t: ReturnType<typeof useTranslations<'bo'>>): string {
  switch (failure.kind) {
    case 'invalid':
      return t('new_student.invalid_error')
    case 'exists':
      return t('classroom_accounts.error_exists')
    case 'in_use':
      return t('classroom_accounts.error_in_use')
    case 'unavailable':
      return t('classroom_accounts.error_unavailable')
    default:
      return t('classroom_accounts.error_generic')
  }
}

/**
 * The accounts list and its actions (OOC-196). The password is never part of
 * the list: "Ver contraseña" asks the API for it on the click, and that call
 * is the audit line.
 */
export function ClassroomAccountsView({ list, canManage }: { list: ClassroomAccountList; canManage: boolean }) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<ClassroomCredentials | null>(null)
  const [retiring, setRetiring] = useState<ClassroomAccountRow | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  const columns = [
    t('classroom_accounts.col_account'),
    t('classroom_accounts.col_teachers'),
    t('classroom_accounts.col_password'),
    ...(canManage ? [t('classroom_accounts.col_actions')] : []),
  ]

  async function reveal(account: ClassroomAccountRow) {
    setPendingId(account.id)
    setActionError(null)
    const result = await revealClassroomPassword(account.id)
    setPendingId(null)
    if (result.ok) setRevealed(result.value)
    else setActionError(failureText(result.failure, t))
  }

  async function retire(account: ClassroomAccountRow) {
    setPendingId(account.id)
    setActionError(null)
    const result = await retireClassroomAccount(account.id)
    setPendingId(null)
    setRetiring(null)
    if (!result.ok) {
      setActionError(failureText(result.failure, t))
      return
    }
    setToast(t('classroom_accounts.retired'))
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          {t('classroom_accounts.intro', { max: list.maxTeachers })}
        </p>
        {canManage && !creating && (
          <button type="button" onClick={() => setCreating(true)} className={primaryClass}>
            <BoIcon name="plus" size={16} />
            {t('classroom_accounts.new')}
          </button>
        )}
      </div>

      {creating && (
        <AccountForm
          mode="create"
          onCancel={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            setToast(t('classroom_accounts.created'))
            router.refresh()
          }}
        />
      )}

      {actionError && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </p>
      )}

      {list.items.length === 0 ? (
        <EmptyState icon="key" title={t('classroom_accounts.empty_title')} body={t('classroom_accounts.empty_body')} />
      ) : (
        <Card>
          <TableShell columns={columns}>
            <thead>
              <tr>
                <th className={thClass}>{columns[0]}</th>
                <th className={thClass}>
                  <span className="flex items-center gap-1.5">
                    {columns[1]}
                    <HelpHint
                      what={t('help.classroom_seats_what', { max: list.maxTeachers })}
                      how={t('help.classroom_seats_how')}
                    />
                  </span>
                </th>
                <th className={thClass}>
                  <span className="flex items-center gap-1.5">
                    {columns[2]}
                    <HelpHint what={t('help.classroom_change_due_what')} how={t('help.classroom_change_due_how')} />
                  </span>
                </th>
                {canManage && <th className={thClass}>{columns[3]}</th>}
              </tr>
            </thead>
            <tbody>
              {list.items.map((account) =>
                editing === account.id ? (
                  <tr key={account.id}>
                    <td className={tdClass} colSpan={columns.length}>
                      <AccountForm
                        mode="edit"
                        account={account}
                        onCancel={() => setEditing(null)}
                        onSaved={() => {
                          setEditing(null)
                          setToast(t('classroom_accounts.saved'))
                          router.refresh()
                        }}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={account.id} className="border-t border-line align-top">
                    <td className={tdClass}>
                      <div className="flex flex-col items-start gap-1.5">
                        <span className="break-all font-medium text-ink">{account.email}</span>
                        {account.passwordChangeDue && (
                          <StatusBadge tone="warning" label={t('classroom_accounts.change_due')} />
                        )}
                      </div>
                    </td>
                    <td className={tdClass}>
                      <div className="flex flex-col gap-1">
                        <span className="tabular-nums text-ink">
                          {t('classroom_accounts.seats', { count: account.teachers.length, max: list.maxTeachers })}
                          {account.teachers.length >= list.maxTeachers && (
                            <span className="ml-2">
                              <StatusBadge tone="neutral" dot={false} label={t('classroom_accounts.full')} />
                            </span>
                          )}
                        </span>
                        {account.teachers.length === 0 ? (
                          <span className="text-xs text-muted-foreground">{t('classroom_accounts.no_teachers')}</span>
                        ) : (
                          <ul className="flex flex-col gap-0.5 text-xs">
                            {account.teachers.map((teacher) => (
                              <li key={teacher.id}>
                                <Link
                                  href={`/backoffice/teachers/${teacher.id}`}
                                  className="text-brand-blue hover:underline"
                                >
                                  {`${teacher.firstName} ${teacher.lastName}`}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </td>
                    <td className={`${tdClass} text-muted-foreground`}>
                      {t('classroom_accounts.password_changed', {
                        date: formatDate(account.passwordChangedAt, locale),
                      })}
                    </td>
                    {canManage && (
                      <td className={tdClass}>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={pendingId === account.id}
                            onClick={() => void reveal(account)}
                            className={secondaryClass}
                          >
                            <BoIcon name="eye" size={16} />
                            {t('classroom_accounts.show_password')}
                          </button>
                          <button type="button" onClick={() => setEditing(account.id)} className={secondaryClass}>
                            <BoIcon name="edit" size={16} />
                            {t('classroom_accounts.edit')}
                          </button>
                          <button
                            type="button"
                            disabled={pendingId === account.id || account.teachers.length > 0}
                            title={account.teachers.length > 0 ? t('classroom_accounts.error_in_use') : undefined}
                            onClick={() => setRetiring(account)}
                            className={secondaryClass}
                          >
                            <BoIcon name="trash" size={16} />
                            {t('classroom_accounts.retire')}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ),
              )}
            </tbody>
          </TableShell>
        </Card>
      )}

      <Dialog open={revealed !== null} onOpenChange={(open) => !open && setRevealed(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('classroom_accounts.reveal_title')}</DialogTitle>
            <DialogDescription>{t('classroom_accounts.audit_note')}</DialogDescription>
          </DialogHeader>
          {revealed && <ClassroomCredentialsCard credentials={revealed} />}
        </DialogContent>
      </Dialog>

      <Dialog open={retiring !== null} onOpenChange={(open) => !open && setRetiring(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('classroom_accounts.retire_title')}</DialogTitle>
            <DialogDescription>
              {retiring ? t('classroom_accounts.retire_body', { email: retiring.email }) : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setRetiring(null)} className={secondaryClass}>
              {t('classroom_accounts.cancel')}
            </button>
            <button
              type="button"
              disabled={retiring !== null && pendingId === retiring.id}
              onClick={() => retiring && void retire(retiring)}
              className={primaryClass}
            >
              {t('classroom_accounts.retire')}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}

/** Registering an account, or changing one's e-mail or password. A blank new password keeps the current one. */
function AccountForm({
  mode,
  account,
  onCancel,
  onSaved,
}: {
  mode: 'create' | 'edit'
  account?: ClassroomAccountRow
  onCancel: () => void
  onSaved: () => void
}) {
  const t = useTranslations('bo')
  const [email, setEmail] = useState(account?.email ?? '')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<ClassroomAccountFailure | null>(null)

  const ready = email.trim() !== '' && (mode === 'edit' || password !== '')
  const fieldError = (key: 'email' | 'password') => (failure?.kind === 'invalid' ? failure.fields[key] : undefined)

  async function submit() {
    if (!ready || pending) return
    setPending(true)
    setFailure(null)
    const result =
      mode === 'create'
        ? await createClassroomAccount({ email: email.trim(), password })
        : await updateClassroomAccount(account!.id, {
            ...(email.trim() !== account!.email ? { email: email.trim() } : {}),
            ...(password !== '' ? { password } : {}),
          })
    setPending(false)
    if (!result.ok) {
      setFailure(result.failure)
      return
    }
    onSaved()
  }

  return (
    <Card className="p-4">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        className="flex flex-col gap-3"
      >
        <AutoGrid min="15rem" gap="gap-3">
          <label className="flex flex-col gap-1">
            <span className={labelClass}>{t('classroom_accounts.field_email')}</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="off"
              className={fieldClass}
            />
            <FieldMessage code={fieldError('email')} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>
              {t(mode === 'create' ? 'classroom_accounts.field_password' : 'classroom_accounts.field_new_password')}
            </span>
            {/* Plain text on purpose: it is a shared login staff hand out, and
                a typo here locks out every teacher on the account. */}
            <input
              type="text"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className={`${fieldClass} font-mono`}
            />
            {mode === 'edit' && (
              <span className="text-xs text-muted-foreground">{t('classroom_accounts.new_password_hint')}</span>
            )}
            <FieldMessage code={fieldError('password')} />
          </label>
        </AutoGrid>
        {failure && failure.kind !== 'invalid' && (
          <p role="alert" className="text-sm font-semibold text-red-600">
            {failureText(failure, t)}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onCancel} className={secondaryClass}>
            {t('classroom_accounts.cancel')}
          </button>
          <button type="submit" disabled={!ready || pending} className={primaryClass}>
            {t(mode === 'create' ? 'classroom_accounts.create' : 'classroom_accounts.save')}
          </button>
        </div>
      </form>
    </Card>
  )
}
