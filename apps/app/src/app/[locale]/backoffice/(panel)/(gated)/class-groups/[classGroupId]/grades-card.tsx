'use client'

import { Fragment, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import type { ClassGroupStatus, GradeStatus } from '@/lib/backoffice/types'
import type { GradeSheetSeat, SheetGrade } from '@/lib/backoffice/grades'
import { correctGrade, postGrade, type GradeErrorKey, type GradeInput } from '@/lib/backoffice/grades-client'
import { DA_MARK, finalStatus, parseGrade } from '@/lib/grade-sheet'
import { formatDateTime, formatNumber, type Locale } from '@/lib/format'
import { Card, StatusBadge, TableShell, tdClass, thClass } from '@/components/backoffice/ui'
import { gradeTone } from '@/components/backoffice/status-tone'
import { Toast } from '@/components/backoffice/controls'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

/** A posting is open while the class group runs and after its last class — the API's GRADING_OPEN. */
const POSTING_OPEN: ReadonlySet<ClassGroupStatus> = new Set(['in_progress', 'finished'])
/** A correction also after coordination closes it — the API's CORRECTION_OPEN. */
const CORRECTION_OPEN: ReadonlySet<ClassGroupStatus> = new Set(['in_progress', 'finished', 'closed'])
/** The database's bound on a correction's reason (0052). */
const MAX_REASON = 500

const fieldClass =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'
const smallButtonClass =
  'inline-flex min-h-tap items-center rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-sky-soft disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-0'
const primaryButtonClass =
  'inline-flex min-h-tap w-full items-center justify-center rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-h-0'

type Editing = { mode: 'post' | 'correct'; seat: GradeSheetSeat }

/** The seat's result against the pass mark of the day — DA fails, no grade is pending. */
function resultOf(grade: SheetGrade | null, passingGrade: number): GradeStatus {
  if (!grade) return 'pending'
  if (grade.didNotSit || grade.grade === null) return 'auto_failed'
  return finalStatus(grade.grade, passingGrade)
}

/**
 * The class group's grades as the academic supervision reads them (OOC-102):
 * every confirmed seat, its final grade — the posted one or its last
 * correction — and the history behind it. The supervision posts what is
 * missing and corrects a posted grade with a reason; the analyst only reads.
 * Who may do what is the API's (GRADE_READ_ROLES / GRADE_WRITE_ROLES); the
 * buttons only spare a refusal.
 *
 * `seats` null is a failed read, `passingGrade` null a failed settings read:
 * both say so instead of drawing a sheet that may be wrong (CLAUDE.md §5).
 */
export function GradesCard({
  classGroupId,
  status,
  seats,
  passingGrade,
  canEdit,
}: {
  classGroupId: string
  status: ClassGroupStatus
  seats: GradeSheetSeat[] | null
  passingGrade: number | null
  canEdit: boolean
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const router = useRouter()
  const [editing, setEditing] = useState<Editing | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<string | null>(null)

  const header = <p className="text-sm font-semibold text-ink">{t('class_group_grades.title')}</p>

  if (seats === null || passingGrade === null) {
    return (
      <Card className="p-5">
        {header}
        <p role="alert" className="mt-3 text-sm text-red-700">
          {t('class_group_grades.load_error')}
        </p>
      </Card>
    )
  }

  const gradeText = (grade: SheetGrade | { grade: number | null; didNotSit: boolean }) =>
    grade.didNotSit || grade.grade === null ? DA_MARK : formatNumber(grade.grade, locale)

  const columns = [
    t('class_group_grades.col_student'),
    t('class_group_grades.col_grade'),
    t('class_group_grades.col_status'),
    ...(canEdit ? [t('class_group_grades.col_actions')] : []),
  ]

  function toggle(enrollmentId: string) {
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(enrollmentId)) next.delete(enrollmentId)
      else next.add(enrollmentId)
      return next
    })
  }

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-1">
        {header}
        <p className="text-sm text-muted-foreground">
          {t('class_group_grades.intro', { min: formatNumber(passingGrade, locale) })}
        </p>
        {!canEdit && <p className="text-xs text-muted-foreground">{t('class_group_grades.read_only')}</p>}
        {canEdit && !POSTING_OPEN.has(status) && (
          <p className="text-xs text-muted-foreground">{t('class_group_grades.posting_closed')}</p>
        )}
      </div>

      {seats.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t('class_group_grades.empty')}</p>
      ) : (
        <div className="mt-4">
          <TableShell columns={columns}>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column} className={thClass}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {seats.map((seat) => {
                const name = `${seat.firstName} ${seat.lastName}`
                const grade = seat.grade
                const result = resultOf(grade, passingGrade)
                const showing = open.has(seat.enrollmentId)
                return (
                  <Fragment key={seat.enrollmentId}>
                    <tr>
                      <td className={tdClass}>{name}</td>
                      <td className={tdClass}>
                        {grade ? (
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold tabular-nums">{gradeText(grade)}</span>
                            {grade.correctedAt && (
                              <StatusBadge tone="info" label={t('class_group_grades.corrected_badge')} />
                            )}
                            <button
                              type="button"
                              onClick={() => toggle(seat.enrollmentId)}
                              aria-expanded={showing}
                              className="text-xs font-semibold text-brand-blue hover:text-brand-blue-deep"
                            >
                              {showing ? t('class_group_grades.history_hide') : t('class_group_grades.history_show')}
                            </button>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{t('class_group_grades.not_posted')}</span>
                        )}
                      </td>
                      <td className={tdClass}>
                        <StatusBadge tone={gradeTone[result]} label={t(`grade_status.${result}`)} />
                      </td>
                      {canEdit && (
                        <td className={tdClass}>
                          {grade ? (
                            <button
                              type="button"
                              className={smallButtonClass}
                              disabled={!CORRECTION_OPEN.has(status)}
                              onClick={() => setEditing({ mode: 'correct', seat })}
                            >
                              {t('class_group_grades.correct')}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={smallButtonClass}
                              disabled={!POSTING_OPEN.has(status)}
                              onClick={() => setEditing({ mode: 'post', seat })}
                            >
                              {t('class_group_grades.post')}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                    {grade && showing && (
                      <tr>
                        <td colSpan={columns.length} className="border-b border-line/70 bg-slate-50/70 px-4 py-3">
                          <ol className="flex flex-col gap-2">
                            {grade.history.map((step, index) => {
                              const who = step.byName ?? t('class_group_grades.history_unknown_name')
                              const when = formatDateTime(step.at, locale)
                              return (
                                <li key={`${step.at}-${index}`} className="text-sm text-ink">
                                  <span className="font-semibold tabular-nums">{gradeText(step)}</span>
                                  {' · '}
                                  <span className="text-muted-foreground">
                                    {index === 0
                                      ? t('class_group_grades.history_posted', { name: who, date: when })
                                      : t('class_group_grades.history_corrected', { name: who, date: when })}
                                  </span>
                                  {step.reason && (
                                    <span className="block text-xs text-muted-foreground">
                                      {t('class_group_grades.history_reason', { reason: step.reason })}
                                    </span>
                                  )}
                                </li>
                              )
                            })}
                          </ol>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </TableShell>
        </div>
      )}

      {editing && (
        <GradeDialog
          key={`${editing.mode}:${editing.seat.enrollmentId}`}
          editing={editing}
          classGroupId={classGroupId}
          currentText={editing.seat.grade ? gradeText(editing.seat.grade) : null}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null)
            setToast(message)
            router.refresh()
          }}
        />
      )}

      <Toast message={toast} onDismiss={() => setToast(null)} duration={5000} />
    </Card>
  )
}

function GradeDialog({
  editing,
  classGroupId,
  currentText,
  onClose,
  onSaved,
}: {
  editing: Editing
  classGroupId: string
  currentText: string | null
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const t = useTranslations('bo')
  const correcting = editing.mode === 'correct'
  const name = `${editing.seat.firstName} ${editing.seat.lastName}`

  const [raw, setRaw] = useState('')
  const [didNotSit, setDidNotSit] = useState(false)
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState<'invalid_grade' | 'reason_required' | null>(null)
  const [error, setError] = useState<GradeErrorKey | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit() {
    setError(null)
    const score = didNotSit ? null : parseGrade(raw)
    if (!didNotSit && score === null) {
      setProblem('invalid_grade')
      return
    }
    const trimmed = reason.trim()
    if (correcting && (trimmed.length === 0 || trimmed.length > MAX_REASON)) {
      setProblem('reason_required')
      return
    }
    setProblem(null)
    const grade: GradeInput = didNotSit ? 'da' : (score as number)

    setSaving(true)
    if (correcting) {
      const result = await correctGrade(classGroupId, editing.seat.enrollmentId, grade, trimmed)
      setSaving(false)
      if (result.ok) onSaved(t('class_group_grades.saved_correct'))
      else setError(result.error)
      return
    }
    const result = await postGrade(classGroupId, editing.seat.enrollmentId, grade)
    setSaving(false)
    if (result.ok) {
      onSaved(
        result.data.finished ? t('class_group_grades.finished_notice') : t('class_group_grades.saved_post'),
      )
    } else setError(result.error)
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent closeLabel={t('class_group_grades.close')} className="bg-white">
        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1">
            <DialogTitle className="text-base font-semibold text-ink">
              {correcting
                ? t('class_group_grades.dialog_correct_title', { name })
                : t('class_group_grades.dialog_post_title', { name })}
            </DialogTitle>
            <DialogDescription>
              {correcting ? t('class_group_grades.dialog_correct_body') : t('class_group_grades.dialog_post_body')}
            </DialogDescription>
            {correcting && currentText && (
              <p className="text-sm font-semibold text-ink">
                {t('class_group_grades.current_value', { value: currentText })}
              </p>
            )}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('class_group_grades.field_grade')}
            </span>
            <input
              inputMode="decimal"
              autoComplete="off"
              value={raw}
              disabled={didNotSit}
              onChange={(event) => setRaw(event.target.value)}
              aria-invalid={problem === 'invalid_grade'}
              className={fieldClass}
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={didNotSit}
              onChange={(event) => setDidNotSit(event.target.checked)}
              className="size-4"
            />
            {t('class_group_grades.field_da')}
          </label>

          {correcting && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('class_group_grades.field_reason')}
              </span>
              <textarea
                rows={3}
                maxLength={MAX_REASON}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                aria-invalid={problem === 'reason_required'}
                className={fieldClass}
              />
              <span className="text-xs text-muted-foreground">{t('class_group_grades.field_reason_hint')}</span>
            </label>
          )}

          <p className="text-xs text-muted-foreground">{t('class_group_grades.email_notice')}</p>

          {problem && (
            <p role="alert" className="text-sm text-red-700">
              {t(`class_group_grades.${problem}`)}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {t(`class_group_grades.errors.${error}`)}
            </p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <button type="button" className={primaryButtonClass} disabled={saving} onClick={() => void submit()}>
              {saving
                ? t('class_group_grades.saving')
                : correcting
                  ? t('class_group_grades.confirm_correct')
                  : t('class_group_grades.confirm_post')}
            </button>
            <button type="button" className={`${smallButtonClass} justify-center`} disabled={saving} onClick={onClose}>
              {t('class_group_grades.cancel')}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
