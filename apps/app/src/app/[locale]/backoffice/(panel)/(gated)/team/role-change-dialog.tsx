'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { StaffMemberRow, StaffRole } from '@/lib/backoffice/types'
import { BoIcon } from '@/components/backoffice/icons'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * Cargos a promotion can move an account onto. `teacher` is deliberately
 * absent from both ends: that cargo travels with the roster file it is scoped
 * by (`teacherId`), so it is opened and closed from Docentes, never here. And
 * `master` is never granted from here — an account is born master through the
 * owners'-domain invite, or not at all.
 */
const ROLES: StaffRole[] = [
  'admin',
  'analyst',
  'enrollment_supervisor',
  'academic_supervisor',
  'sales',
  'support',
  'billing',
]

const fieldClass =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

const labelClass =
  'text-xs font-medium uppercase tracking-wide text-muted-foreground'

/**
 * Changing a cargo — the one action the whole section exists for, and the one
 * the platform guards hardest (CLAUDE.md §8).
 *
 * The password field is not decoration: the promotion usecase demands a fresh
 * re-authentication of the admin doing it, so an open session left on an
 * unlocked screen cannot hand out administración. This screen only collects it
 * — `PATCH /api/v1/staff/:id/role` is where it is actually verified
 * (`PromoteUserRoleUseCase`), and where the `role` column and the append-only
 * audit entry are written.
 */
export function RoleChangeDialog({
  member,
  onClose,
  onConfirm,
}: {
  member: StaffMemberRow | null
  onClose: () => void
  /** Returns whether the change went through — `false` keeps the dialog open
   * with an inline error (wrong re-auth password), same as any other form. */
  onConfirm: (member: StaffMemberRow, role: StaffRole, password: string) => Promise<boolean>
}) {
  const t = useTranslations('bo')
  const [role, setRole] = useState<StaffRole>('enrollment_supervisor')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [wrongPassword, setWrongPassword] = useState(false)

  /* Reopening the dialog on a different person must not inherit the last one's
     answers — least of all the password. */
  useEffect(() => {
    if (!member) return
    setRole(ROLES.find((item) => item !== member.role) ?? 'enrollment_supervisor')
    setPassword('')
    setWrongPassword(false)
  }, [member])

  const ready = member !== null && role !== member.role && password.trim() !== '' && !pending

  async function submit() {
    if (!member || !ready) return
    setPending(true)
    setWrongPassword(false)
    const ok = await onConfirm(member, role, password)
    setPending(false)
    if (!ok) setWrongPassword(true)
  }

  return (
    <Dialog
      open={member !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent closeLabel={t('team.change_close')} className="bg-white">
        {member && (
          <>
            <DialogHeader className="gap-2 border-b border-line p-5 pr-14">
              <DialogTitle className="text-base font-semibold text-ink">
                {t('team.change_title')}
              </DialogTitle>
            </DialogHeader>

            {/*
              A real <form> boundary, not just styled divs — without one, a
              lone password input has no form to belong to, and the browser's
              autofill goes looking for a "username" field anywhere on the
              page instead of stopping at this dialog. That is what was
              landing an admin's saved e-mail in the table's search box: with
              no form to search first, the closest text input Chrome found
              was outside this dialog entirely, and typing into it re-ran the
              directory's own filter (`filtered`, above) down to whatever
              matched that text — here, just the admin. `autoComplete="off"`
              on that search input (team-view.tsx) is the other half of the
              fix: it takes the field out of consideration regardless of
              which form ends up nearest.
            */}
            <form
              onSubmit={(event) => {
                event.preventDefault()
                submit()
              }}
            >
              <div className="flex flex-col gap-4 p-5">
                <div className="flex flex-col gap-1">
                  <span className={labelClass}>{t('team.change_current')}</span>
                  <span className="w-fit rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                    {t(`role.${member.role}`)}
                  </span>
                </div>

                <label className="flex flex-col gap-1">
                  <span className={labelClass}>{t('team.change_new')}</span>
                  <select
                    value={role}
                    onChange={(event) => setRole(event.target.value as StaffRole)}
                    className={fieldClass}
                  >
                    {ROLES.filter((item) => item !== member.role).map((item) => (
                      <option key={item} value={item}>
                        {t(`role.${item}`)}
                      </option>
                    ))}
                  </select>
                </label>


                <div className="flex flex-col gap-1">
                  {/* The hint sits outside the label on purpose: inside it, it
                      becomes part of the field's accessible name and a screen
                      reader announces the whole rule as the field's title. */}
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>{t('team.change_reauth')}</span>
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                      className={fieldClass}
                    />
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {t('team.change_reauth_hint')}
                  </span>
                  {wrongPassword && (
                    <p role="alert" className="text-xs font-semibold text-red-600">
                      {t('team.reauth_wrong_password')}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line p-5">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={pending}
                  className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {t('team.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={!ready}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-blue"
                >
                  <BoIcon name={pending ? 'spinner' : 'check'} size={16} className={pending ? 'animate-spin' : undefined} />
                  {pending ? t('team.changing') : t('team.change_confirm')}
                </button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
