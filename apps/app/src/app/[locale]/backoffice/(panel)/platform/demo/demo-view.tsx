'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { formatDateTime, type Locale } from '@/lib/format'
import type { DemoAccessKind, DemoAccessRow, DemoAccessesOverview } from '@/lib/backoffice/demo-accesses'
import { Card, EmptyState, StatusBadge, TableShell, tdClass, thClass } from '@/components/backoffice/ui'
import { Toast } from '@/components/backoffice/controls'
import { HelpField, HelpHint } from '@/components/backoffice/help-hint'
import { BoIcon } from '@/components/backoffice/icons'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const fieldClass =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'
const primaryButtonClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40'
const secondaryButtonClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40'
const dangerButtonClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60'

const KINDS: DemoAccessKind[] = ['student', 'teacher']

type CreateError = 'not_gmail' | 'email_in_use' | 'course_unavailable' | 'invite_refused' | 'failed'

function createError(reason: string | undefined): CreateError {
  if (reason === 'demo_access.student_email_not_gmail') return 'not_gmail'
  if (reason === 'demo_access.email_in_use' || reason === 'staff_invite.email_taken') return 'email_in_use'
  if (reason === 'demo_access.course_unavailable') return 'course_unavailable'
  if (reason === 'staff_profile.beyond_own_permissions') return 'invite_refused'
  return 'failed'
}

async function reasonOf(response: Response): Promise<string | undefined> {
  try {
    return ((await response.json()) as { reason?: string }).reason
  } catch {
    return undefined
  }
}

/**
 * The owners' demo accesses (28/11/2026). Opening one writes a demo class
 * group in the course picked, with the client inside it — as a student with a
 * confirmed seat, or as the teacher with a few fictitious students — and sends
 * the usual link to set a password (or the teacher invite). None of it shows
 * in the team's lists. Revoking closes the account for good.
 */
export function DemoAccessesView({ overview }: { overview: DemoAccessesOverview }) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const router = useRouter()
  const [kind, setKind] = useState<DemoAccessKind>('student')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [courseId, setCourseId] = useState(overview.courses[0]?.id ?? '')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<CreateError | null>(null)
  const [revoking, setRevoking] = useState<DemoAccessRow | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const ready = firstName.trim() !== '' && lastName.trim() !== '' && email.trim() !== '' && courseId !== ''

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready || pending) return
    setPending(true)
    setFailure(null)
    try {
      const response = await fetch('/api/v1/platform/demo-accesses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, firstName, lastName, email, courseId }),
      })
      if (!response.ok) {
        setFailure(createError(await reasonOf(response)))
        return
      }
      setFirstName('')
      setLastName('')
      setEmail('')
      setToast(t(`demo.created_${kind}`))
      router.refresh()
    } catch {
      setFailure('failed')
    } finally {
      setPending(false)
    }
  }

  async function revoke(access: DemoAccessRow): Promise<boolean> {
    try {
      const response = await fetch(`/api/v1/platform/demo-accesses/${access.id}/revoke`, { method: 'POST' })
      if (!response.ok) return false
      setRevoking(null)
      setToast(t('demo.revoked'))
      router.refresh()
      return true
    } catch {
      return false
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex items-start gap-3 p-4 text-sm text-ink">
        <BoIcon name="eye" size={18} className="mt-0.5 shrink-0 text-brand-blue" />
        <p>{t('demo.intro')}</p>
      </Card>

      <section className="flex flex-col gap-3">
        <span className="flex items-center gap-1.5">
          <h2 className="text-base font-semibold text-ink">{t('demo.new_title')}</h2>
          <HelpHint what={t('help.demo_access_what')} how={t('help.demo_access_how')} />
        </span>
        {overview.courses.length === 0 ? (
          <EmptyState icon="courses" title={t('demo.no_courses_title')} body={t('demo.no_courses_body')} />
        ) : (
          <Card as="section" className="p-4">
            <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" autoComplete="off">
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink">
                  {t('demo.field_kind')}
                  <HelpHint what={t('help.demo_kind_what')} how={t('help.demo_kind_how')} />
                </legend>
                <div className="flex flex-wrap gap-2">
                  {KINDS.map((option) => (
                    <label
                      key={option}
                      className={`inline-flex min-h-tap cursor-pointer items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-semibold transition ${
                        kind === option ? 'border-brand-blue bg-sky text-brand-blue' : 'border-line text-muted-foreground hover:text-ink'
                      }`}
                    >
                      <input
                        type="radio"
                        name="demo-kind"
                        value={option}
                        checked={kind === option}
                        onChange={() => {
                          setKind(option)
                          setFailure(null)
                        }}
                        className="sr-only"
                      />
                      <BoIcon name={option === 'student' ? 'students' : 'teachers'} size={16} />
                      {t(`demo.kind.${option}`)}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
                  {t('demo.field_first_name')}
                  <input value={firstName} onChange={(event) => setFirstName(event.target.value)} maxLength={80} className={fieldClass} />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
                  {t('demo.field_last_name')}
                  <input value={lastName} onChange={(event) => setLastName(event.target.value)} maxLength={80} className={fieldClass} />
                </label>
                <HelpField
                  label={t('demo.field_email')}
                  what={t(kind === 'student' ? 'help.demo_email_student_what' : 'help.demo_email_teacher_what')}
                  how={t('help.demo_email_how')}
                >
                  {(id) => (
                    <input
                      id={id}
                      type="email"
                      inputMode="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value)
                        setFailure(null)
                      }}
                      placeholder={t(kind === 'student' ? 'demo.email_placeholder_student' : 'demo.email_placeholder_teacher')}
                      maxLength={254}
                      className={fieldClass}
                    />
                  )}
                </HelpField>
                <HelpField label={t('demo.field_course')} what={t('help.demo_course_what')} how={t('help.demo_course_how')}>
                  {(id) => (
                    <select id={id} value={courseId} onChange={(event) => setCourseId(event.target.value)} className={fieldClass}>
                      {overview.courses.map((course) => (
                        <option key={course.id} value={course.id}>
                          {course.language} · {course.name}
                        </option>
                      ))}
                    </select>
                  )}
                </HelpField>
              </div>

              {failure && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
                >
                  <BoIcon name="alert" size={16} className="mt-0.5 shrink-0" />
                  {t(`demo.error.${failure}`)}
                </p>
              )}

              <div className="flex justify-end">
                <button type="submit" disabled={!ready || pending} className={primaryButtonClass}>
                  <BoIcon name={pending ? 'spinner' : 'plus'} size={16} className={pending ? 'animate-spin' : undefined} />
                  {t(`demo.create_${kind}`)}
                </button>
              </div>
            </form>
          </Card>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-ink">{t('demo.list_title')}</h2>
        {overview.accesses.length === 0 ? (
          <EmptyState icon="staff" title={t('demo.empty_title')} body={t('demo.empty_body')} />
        ) : (
          <Card className="overflow-hidden">
            <TableShell
              columns={[t('demo.col_person'), t('demo.col_kind'), t('demo.col_course'), t('demo.col_state'), t('demo.col_created'), '']}
            >
              <thead>
                <tr>
                  <th className={thClass}>{t('demo.col_person')}</th>
                  <th className={thClass}>{t('demo.col_kind')}</th>
                  <th className={thClass}>{t('demo.col_course')}</th>
                  <th className={thClass}>
                    <span className="flex items-center gap-1.5">
                      {t('demo.col_state')}
                      <HelpHint what={t('help.demo_state_what')} how={t('help.demo_state_how')} />
                    </span>
                  </th>
                  <th className={thClass}>{t('demo.col_created')}</th>
                  <th className={thClass} />
                </tr>
              </thead>
              <tbody>
                {overview.accesses.map((access) => (
                  <tr key={access.id}>
                    <td className={tdClass}>
                      <span className="block font-medium">{access.name}</span>
                      <span className="block break-all text-xs text-muted-foreground">{access.email}</span>
                    </td>
                    <td className={tdClass}>{t(`demo.kind.${access.kind}`)}</td>
                    <td className={tdClass}>
                      <span className="block">{access.courseName}</span>
                      <span className="block font-mono text-xs text-muted-foreground">{access.classGroupCode}</span>
                    </td>
                    <td className={tdClass}>
                      {access.revokedAt ? (
                        <StatusBadge tone="neutral" label={t('demo.state.revoked')} />
                      ) : access.activated ? (
                        <StatusBadge tone="success" label={t('demo.state.active')} />
                      ) : (
                        <StatusBadge tone="warning" label={t('demo.state.waiting')} />
                      )}
                    </td>
                    <td className={tdClass}>
                      <span className="block whitespace-nowrap">{formatDateTime(access.createdAt, locale)}</span>
                      {access.createdByName && <span className="block text-xs text-muted-foreground">{access.createdByName}</span>}
                    </td>
                    <td className={`${tdClass} text-right`}>
                      {!access.revokedAt && (
                        <button type="button" className={secondaryButtonClass} onClick={() => setRevoking(access)}>
                          <BoIcon name="close" size={16} />
                          {t('demo.revoke')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </Card>
        )}
      </section>

      <RevokeDialog access={revoking} onClose={() => setRevoking(null)} onConfirm={revoke} />
      <Toast key={toast} message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}

function RevokeDialog({
  access,
  onClose,
  onConfirm,
}: {
  access: DemoAccessRow | null
  onClose: () => void
  onConfirm: (access: DemoAccessRow) => Promise<boolean>
}) {
  const t = useTranslations('bo')
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  async function confirm() {
    if (!access || pending) return
    setPending(true)
    setFailed(false)
    try {
      if (!(await onConfirm(access))) setFailed(true)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={access !== null}
      onOpenChange={(next) => {
        if (!next && !pending) {
          setFailed(false)
          onClose()
        }
      }}
    >
      <DialogContent closeLabel={t('demo.cancel')} className="bg-white">
        {access && (
          <>
            <DialogHeader className="gap-2 border-b border-line p-5 pr-14">
              <DialogTitle className="text-base font-semibold text-ink">{t('demo.revoke_title', { name: access.name })}</DialogTitle>
              <DialogDescription>{t('demo.revoke_body')}</DialogDescription>
            </DialogHeader>
            {failed && (
              <p
                role="alert"
                className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
              >
                <BoIcon name="alert" size={16} className="mt-0.5 shrink-0" />
                {t('demo.error.revoke_failed')}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line p-5">
              <button type="button" onClick={onClose} disabled={pending} className={secondaryButtonClass}>
                {t('demo.cancel')}
              </button>
              <button type="button" onClick={() => void confirm()} disabled={pending} className={dangerButtonClass}>
                <BoIcon name={pending ? 'spinner' : 'close'} size={16} className={pending ? 'animate-spin' : undefined} />
                {t('demo.revoke_confirm')}
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
