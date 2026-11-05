'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import type { StaffMemberRow } from '@/lib/backoffice/types'
import { BoIcon } from '@/components/backoffice/icons'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export type RetireOutcome = 'ok' | 'mismatch' | 'teacher' | 'master' | 'failed'

/** The API's verdict on the request, read as what the dialog has to say about it. */
export function retireOutcome(reason: string | undefined): RetireOutcome {
  if (reason === 'staff_account.confirmation_mismatch') return 'mismatch'
  if (reason === 'staff_account.teacher_linked') return 'teacher'
  if (reason === 'auth.insufficient_privilege') return 'master'
  return 'failed'
}

function sameEmail(typed: string, email: string): boolean {
  return typed.trim().toLowerCase() === email.trim().toLowerCase()
}

/**
 * Deleting a profile cannot be undone from the panel, so it takes more than a
 * click: the button only arms once the person's e-mail has been typed (OOC-136).
 * The API checks the same thing, so this only saves the round trip.
 */
export function RetireAccountDialog({
  member,
  onClose,
  onConfirm,
}: {
  member: StaffMemberRow | null
  onClose: () => void
  onConfirm: (member: StaffMemberRow, confirmEmail: string) => Promise<RetireOutcome>
}) {
  const t = useTranslations('bo')
  const [typed, setTyped] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<Exclude<RetireOutcome, 'ok'> | null>(null)

  /* Reopening on another row must not carry over what was typed for the last one. */
  useEffect(() => {
    setTyped('')
    setPending(false)
    setFailure(null)
  }, [member])

  const armed = member !== null && sameEmail(typed, member.email)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!member || !armed || pending) return
    setPending(true)
    setFailure(null)
    try {
      const outcome = await onConfirm(member, typed)
      if (outcome !== 'ok') setFailure(outcome)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={member !== null}
      onOpenChange={(next) => {
        if (!next && !pending) onClose()
      }}
    >
      <DialogContent closeLabel={t('team.change_close')} className="bg-white">
        {member && (
          <form onSubmit={(event) => void submit(event)} autoComplete="off">
            <DialogHeader className="gap-2 border-b border-line p-5 pr-14">
              <DialogTitle className="text-base font-semibold text-ink">
                {t('team.retire_title')}
              </DialogTitle>
              <DialogDescription>
                {t('team.retire_body', { name: `${member.firstName} ${member.lastName}` })}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 p-5">
              <label className="flex flex-col gap-1.5">
                <span className="break-words text-sm font-medium text-ink">
                  {t('team.retire_type_label', { email: member.email })}
                </span>
                <input
                  type="text"
                  inputMode="email"
                  value={typed}
                  onChange={(event) => {
                    setTyped(event.target.value)
                    setFailure(null)
                  }}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-200"
                />
              </label>

              {failure && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
                >
                  <BoIcon name="alert" size={16} className="mt-0.5 shrink-0" />
                  {t(
                    failure === 'mismatch'
                      ? 'team.retire_error_mismatch'
                      : failure === 'teacher'
                        ? 'team.retire_error_teacher'
                        : failure === 'master'
                          ? 'team.retire_error_master'
                          : 'team.retire_error_failed',
                  )}
                </p>
              )}
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
                disabled={!armed || pending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <BoIcon
                  name={pending ? 'spinner' : 'close'}
                  size={16}
                  className={pending ? 'animate-spin' : undefined}
                />
                {t(pending ? 'team.retiring' : 'team.retire_confirm')}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
