'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { GradeRegister } from '@/lib/backoffice/grade-registers'
import { confirmRegister, returnRegister, type RegisterStepResult } from '@/lib/backoffice/grades-client'
import { Card } from '@/components/backoffice/ui'
import { Toast } from '@/components/backoffice/controls'
import { GradeRegisterSteps, GradeRegisterSummary } from '@/components/grades/grade-register-summary'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** The database's bound on a return note (0074). */
const MAX_NOTE = 1000

const smallButtonClass =
  'inline-flex min-h-tap items-center rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-sky-soft disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-0'
const primaryButtonClass =
  'inline-flex min-h-tap items-center justify-center rounded-lg bg-brand-blue px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0'

type Acting = { kind: 'return' | 'confirm'; register: GradeRegister }

/**
 * The class group's grade registers (OOC-180): one per module group and round
 * of the module. Coordination returns a register in review to its teacher with
 * what to correct, or confirms it — its grades become official, the ones that
 * move a student on and count for the certificate. Confirming works from any
 * open state, so a register a teacher never sent does not stay stuck; the
 * steps keep who did what. Who may act is the API's (GRADE_WRITE_ROLES).
 */
export function GradeRegistersCard({
  classGroupId,
  registers,
  runLabels,
  canEdit,
}: {
  classGroupId: string
  /** Null when the read failed. */
  registers: GradeRegister[] | null
  /** Module group id → how the page names it. */
  runLabels: Record<string, string>
  canEdit: boolean
}) {
  const t = useTranslations('bo.grade_register')
  const router = useRouter()
  const [acting, setActing] = useState<Acting | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const header = <p className="text-sm font-semibold text-ink">{t('title')}</p>

  if (registers === null) {
    return (
      <Card className="p-5">
        {header}
        <p role="alert" className="mt-3 text-sm text-red-700">
          {t('load_error')}
        </p>
      </Card>
    )
  }

  async function act() {
    if (!acting || saving) return
    if (acting.kind === 'return' && (note.trim().length === 0 || note.trim().length > MAX_NOTE)) {
      setError(t('errors.note_required'))
      return
    }
    setSaving(true)
    const result: RegisterStepResult =
      acting.kind === 'return'
        ? await returnRegister(classGroupId, acting.register.classGroupModuleId, note)
        : await confirmRegister(classGroupId, acting.register.classGroupModuleId)
    setSaving(false)
    if (result !== 'done') {
      setError(t(`errors.${result}`))
      return
    }
    setToast(acting.kind === 'return' ? t('returned_toast') : t('confirmed_toast'))
    setActing(null)
    router.refresh()
  }

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-1">
        {header}
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>

      {registers.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-line/70">
          {registers.map((register) => {
            const open = register.status !== 'official'
            const complete = register.graded > 0 && register.graded >= register.total
            return (
              <li
                key={register.registerId ?? `${register.classGroupModuleId}-next`}
                className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-2">
                  <p className="text-sm font-semibold text-ink">
                    {runLabels[register.classGroupModuleId] ?? t('run_fallback')}
                  </p>
                  <GradeRegisterSummary register={register} />
                  <GradeRegisterSteps register={register} />
                </div>
                {canEdit && open && register.registerId !== null && (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {register.status === 'in_review' && (
                      <button
                        type="button"
                        className={smallButtonClass}
                        onClick={() => {
                          setActing({ kind: 'return', register })
                          setNote('')
                          setError(null)
                        }}
                      >
                        {t('return')}
                      </button>
                    )}
                    <button
                      type="button"
                      className={primaryButtonClass}
                      disabled={!complete}
                      title={complete ? undefined : t('confirm_incomplete')}
                      onClick={() => {
                        setActing({ kind: 'confirm', register })
                        setError(null)
                      }}
                    >
                      {t('confirm')}
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <Dialog open={acting !== null} onOpenChange={(next) => !next && !saving && setActing(null)}>
        <DialogContent closeLabel={t('close')} className="sm:max-w-md">
          {acting && (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void act()
              }}
              className="flex flex-col gap-3"
            >
              <DialogHeader>
                <DialogTitle>{acting.kind === 'return' ? t('return_title') : t('confirm_title')}</DialogTitle>
                <DialogDescription>
                  {acting.kind === 'return' ? t('return_body') : t('confirm_body')}
                </DialogDescription>
              </DialogHeader>
              {acting.kind === 'return' && (
                <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
                  {t('return_note_label')}
                  <textarea
                    autoFocus
                    rows={4}
                    maxLength={MAX_NOTE}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm font-normal text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
                  />
                  <span className="text-xs font-normal text-muted-foreground">{t('return_note_hint')}</span>
                </label>
              )}
              {error && (
                <p role="alert" className="text-sm text-red-700">
                  {error}
                </p>
              )}
              <DialogFooter className="sm:flex-row sm:justify-end">
                <button
                  type="button"
                  className={smallButtonClass}
                  disabled={saving}
                  onClick={() => setActing(null)}
                >
                  {t('cancel')}
                </button>
                <button type="submit" className={primaryButtonClass} disabled={saving}>
                  {saving ? t('saving') : acting.kind === 'return' ? t('return') : t('confirm')}
                </button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Toast message={toast} onDismiss={() => setToast(null)} duration={5000} />
    </Card>
  )
}
