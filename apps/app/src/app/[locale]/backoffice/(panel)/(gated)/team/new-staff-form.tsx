'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { getPathname } from '@/i18n/navigation'
import type { StaffMemberRow, StaffRole } from '@/lib/backoffice/types'
import { canHoldMaster } from '@/lib/backoffice/permissions'
import { buildInvitePath } from '@/lib/backoffice/invite'
import { Card, RequiredMark } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { AutoGrid } from '@/components/layout/auto-grid'
import { formatDate, type Locale } from '@/lib/format'

/** A teacher still on the roster — who an account may be opened over. */
export interface TeacherOption {
  id: string
  firstName: string
  lastName: string
  email: string
}

/** `master` is not listed: it only appears for the owners' e-mail domain. */
const ROLES: StaffRole[] = [
  'admin',
  'analyst',
  'enrollment_supervisor',
  'academic_supervisor',
  'teacher',
  'sales',
  'support',
  'billing',
]

const fieldClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

const labelClass =
  'text-xs font-medium uppercase tracking-wide text-muted-foreground'

/**
 * Opening a panel account: who the person is, and which cargo they come in
 * with. Two blocks, because those are the two questions — and the second one is
 * the whole reason this form is admin-only (CLAUDE.md §8).
 *
 * No password field, by design. Nobody but the person invited ever holds one:
 * confirming this step generates a one-time invite link instead — a panel that
 * shows somebody else's password is a panel that has it. The second factor is
 * not set here either — the owner enrolls their own, on first sign-in.
 *
 * A `teacher` account is opened over a teacher who is already on the roster,
 * the same shape as a manual enrollment acting only on a student who already
 * exists (CLAUDE.md §1): the record carries what the account is scoped by, so
 * it has to exist before the door does.
 *
 * Posts to `POST /api/v1/staff/invites` (same-origin `/api/v1/...` proxy, the
 * pattern `new-student-form.tsx` already established) — `CreateStaffInviteUseCase`
 * generates the token server-side; this form never assembles one itself.
 */
export function NewStaffForm({
  teachers,
  onCancel,
  onCreate,
}: {
  teachers: TeacherOption[]
  onCancel: () => void
  onCreate: (member: StaffMemberRow) => void
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  const [step, setStep] = useState<'form' | 'created'>('form')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<StaffRole>('enrollment_supervisor')
  const [teacherId, setTeacherId] = useState('')
  const [created, setCreated] = useState<{ member: StaffMemberRow; link: string } | null>(
    null,
  )
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState(false)
  const [emailTaken, setEmailTaken] = useState(false)
  const [failed, setFailed] = useState(false)

  const isTeacher = role === 'teacher'

  /* Master is the owners' cargo: the option only exists while the e-mail is
     on their domain — the server refuses the pair anyway (route schema). */
  const allowMaster = canHoldMaster(email)
  const roles: StaffRole[] =
    allowMaster || role === 'master' ? ['master', ...ROLES] : ROLES

  const ready =
    firstName.trim() !== '' &&
    lastName.trim() !== '' &&
    email.trim() !== '' &&
    (role !== 'master' || allowMaster) &&
    (!isTeacher || teacherId !== '')

  /* Picking the teacher fills the person in: the roster already answered who
     they are and where to write to them, and retyping it is how two records of
     one person start disagreeing. */
  function selectTeacher(id: string) {
    setTeacherId(id)
    const teacher = teachers.find((item) => item.id === id)
    if (!teacher) return
    setFirstName(teacher.firstName)
    setLastName(teacher.lastName)
    setEmail(teacher.email)
  }

  function selectRole(next: StaffRole) {
    setRole(next)
    if (next !== 'teacher') setTeacherId('')
  }

  async function submit() {
    if (!ready || pending) return
    setPending(true)
    setEmailTaken(false)
    setFailed(false)

    // Every exit from here — a rejected status, a body that doesn't parse, a
    // dropped connection — has to land on one of the two banners below.
    // Leaving any path uncaught is what used to freeze the form on "Gerando…"
    // with the invite already written server-side and no way for the person
    // watching the screen to tell.
    try {
      const response = await fetch('/api/v1/staff/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          role,
        }),
      })

      if (!response.ok) {
        const reason = await response
          .json()
          .then((body: { reason?: string }) => body.reason)
          .catch(() => undefined)
        if (reason === 'staff_invite.email_taken') {
          setEmailTaken(true)
        } else {
          setFailed(true)
        }
        return
      }

      const result = (await response.json()) as {
        inviteId: string
        token: string
        expiresAt: string
      }

      const member: StaffMemberRow = {
        id: result.inviteId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        role,
        status: 'invited',
        teacherId: isTeacher ? teacherId : null,
        // Nobody enrolls somebody else's second factor: the account starts
        // without one and the owner sets it up on first sign-in.
        mfaEnrolled: false,
        joinedAt: new Date().toISOString(),
        lastAccessAt: null,
        inviteToken: result.token,
        inviteExpiresAt: result.expiresAt,
      }

      const path = getPathname({ href: buildInvitePath(result.token), locale })
      const origin = typeof window !== 'undefined' ? window.location.origin : ''

      setCreated({ member, link: `${origin}${path}` })
      setCopied(false)
      setStep('created')
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
    }
  }

  async function copyLink() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.link)
      setCopied(true)
    } catch {
      // Clipboard permission denied or unavailable — the link stays selectable
      // in the field below, so copying by hand still works.
    }
  }

  if (step === 'created' && created) {
    return (
      <Card className="p-5">
        <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
          <BoIcon name="check" size={16} className="text-emerald-600" />
          {t('team.invite_created_title')}
        </p>
        <p className="mb-4 text-xs text-muted-foreground">
          {t('team.invite_created_subtitle', {
            name: `${created.member.firstName} ${created.member.lastName}`,
            date: formatDate(created.member.inviteExpiresAt as string, locale),
          })}
        </p>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>{t('team.invite_link_label')}</span>
          <span className="flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={created.link}
              onFocus={(event) => event.currentTarget.select()}
              className={`${fieldClass} flex-1`}
            />
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-brand-blue transition hover:border-brand-blue"
            >
              <BoIcon name={copied ? 'check' : 'link'} size={16} />
              {t(copied ? 'team.invite_copied' : 'team.invite_copy')}
            </button>
          </span>
        </label>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <button
            type="button"
            onClick={() => onCreate(created.member)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep"
          >
            <BoIcon name="check" size={16} />
            {t('team.invite_done')}
          </button>
        </div>
      </Card>
    )
  }

  return (
    <Card className="p-5">
      <p className="mb-1 text-sm font-semibold text-ink">{t('team.new_title')}</p>

      {(emailTaken || failed) && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {t(emailTaken ? 'team.invite_email_taken' : 'team.action_failed')}
        </div>
      )}

      {/* Access first: the cargo decides whether the rest of the form is typed
          or picked from the roster. */}
      <Block>
        {/* Capped: one or two selects stretched across a wide panel read as a
            form with a field missing. */}
        <AutoGrid min="15rem" gap="gap-3" className="max-w-3xl">
          <Labelled label={t('team.field_role')} required>
            <select
              value={role}
              onChange={(event) => selectRole(event.target.value as StaffRole)}
              className={fieldClass}
            >
              {roles.map((item) => (
                <option key={item} value={item}>
                  {t(`role.${item}`)}
                </option>
              ))}
            </select>
          </Labelled>

          {isTeacher && (
            <Labelled label={t('team.field_teacher')} required>
              <select
                value={teacherId}
                onChange={(event) => selectTeacher(event.target.value)}
                className={fieldClass}
              >
                <option value="">{t('team.teacher_select')}</option>
                {teachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {`${teacher.firstName} ${teacher.lastName}`}
                  </option>
                ))}
              </select>
            </Labelled>
          )}
        </AutoGrid>

        {isTeacher && (
          <p className="mt-3 text-xs text-muted-foreground">{t('team.teacher_hint')}</p>
        )}
      </Block>

      <Block>
        <AutoGrid min="15rem" gap="gap-3">
          <Labelled label={t('team.field_first_name')} required>
            <input
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              disabled={isTeacher}
              className={`${fieldClass} disabled:bg-slate-50 disabled:text-muted-foreground`}
            />
          </Labelled>

          <Labelled label={t('team.field_last_name')} required>
            <input
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              disabled={isTeacher}
              className={`${fieldClass} disabled:bg-slate-50 disabled:text-muted-foreground`}
            />
          </Labelled>

          <Labelled label={t('team.field_email')} required>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={isTeacher}
              className={`${fieldClass} disabled:bg-slate-50 disabled:text-muted-foreground`}
            />
          </Labelled>
        </AutoGrid>
      </Block>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <button
          type="button"
          disabled={!ready || pending}
          onClick={submit}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-blue"
        >
          <BoIcon name={pending ? 'spinner' : 'link'} size={16} className={pending ? 'animate-spin' : undefined} />
          {pending ? t('team.creating') : t('team.create')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
        >
          {t('team.cancel')}
        </button>
      </div>
    </Card>
  )
}

/** One question per block, with a rule above it — that is the whole layout. */
function Block({ children }: { children: React.ReactNode }) {
  return (
    <section className="mt-5 border-t border-line pt-4">
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Labelled({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  const t = useTranslations('bo')
  return (
    <label className="flex flex-col gap-1">
      <span className={labelClass}>
        {label}
        {required && <RequiredMark label={t('common.required')} />}
      </span>
      {children}
    </label>
  )
}
