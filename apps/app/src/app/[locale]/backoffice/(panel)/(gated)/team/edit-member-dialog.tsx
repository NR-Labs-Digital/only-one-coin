'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import type { StaffMemberRow } from '@/lib/backoffice/types'
import { rowActionClass } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { HelpHint } from '@/components/backoffice/help-hint'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** What this account may have done to it from here — each already gated by the caller. */
export interface EditMemberOptions {
  /** Cargo change offered; `false` with `roleLocked` says why it is not. */
  changeRole: boolean
  /** A docente's cargo travels with the roster file (OOC-79). */
  roleLocked: boolean
  resetPassword: boolean
  retire: boolean
}

/**
 * The account's edit screen (OOC-198): the list keeps only *Editar* and
 * *Bloquear*, and everything else that changes the account lives here.
 * Each action still opens its own dialog — re-authentication for the cargo,
 * the typed e-mail for deleting — so this one closes first and hands over,
 * instead of stacking a dialog on top of another.
 */
export function EditMemberDialog({
  member,
  cargoLabel,
  options,
  busy,
  onClose,
  onChangeRole,
  onResetPassword,
  onRetire,
}: {
  member: StaffMemberRow | null
  cargoLabel: string
  options: EditMemberOptions
  busy: boolean
  onClose: () => void
  onChangeRole: (member: StaffMemberRow) => void
  onResetPassword: (member: StaffMemberRow) => void
  onRetire: (member: StaffMemberRow) => void
}) {
  const t = useTranslations('bo')

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
                {t('team.edit_title')}
              </DialogTitle>
              <DialogDescription>
                {`${member.firstName} ${member.lastName} · ${member.email}`}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col divide-y divide-line">
              <Section
                title={t('team.col_role')}
                hint={
                  <HelpHint
                    what={t('help.admin_team_cargo_what')}
                    how={t('help.admin_team_cargo_how')}
                  />
                }
                body={
                  <span className="w-fit rounded-full bg-sky px-2 py-0.5 text-[11px] font-semibold text-brand-blue-deep">
                    {cargoLabel}
                  </span>
                }
                note={options.roleLocked ? t('team.teacher_locked') : null}
                action={
                  options.changeRole && (
                    <button
                      type="button"
                      onClick={() => onChangeRole(member)}
                      className={rowActionClass}
                    >
                      <BoIcon name="edit" size={14} />
                      {t('team.change_role')}
                    </button>
                  )
                }
              />

              {options.resetPassword && (
                <Section
                  title={t('team.edit_password_heading')}
                  hint={
                    <HelpHint
                      what={t('help.admin_team_reset_password_what')}
                      how={t('help.admin_team_reset_password_how')}
                    />
                  }
                  note={t('team.edit_password_body')}
                  action={
                    <button
                      type="button"
                      onClick={() => onResetPassword(member)}
                      disabled={busy}
                      className={`${rowActionClass} disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <BoIcon
                        name={busy ? 'spinner' : 'key'}
                        size={14}
                        className={busy ? 'animate-spin' : undefined}
                      />
                      {t('team.reset_password')}
                    </button>
                  }
                />
              )}

              {options.retire && (
                <Section
                  title={t('team.retire_title')}
                  note={t('team.edit_retire_body')}
                  action={
                    <button
                      type="button"
                      onClick={() => onRetire(member)}
                      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-red-200 px-2.5 py-1.5 text-sm font-semibold text-red-600 transition hover:border-red-400 hover:bg-red-50"
                    >
                      <BoIcon name="close" size={14} />
                      {t('team.retire_action')}
                    </button>
                  }
                />
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Section({
  title,
  hint,
  body,
  note,
  action,
}: {
  title: string
  hint?: ReactNode
  body?: ReactNode
  note?: string | null
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          {title}
          {hint}
        </span>
        {body}
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
