'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import type { TeachingClassGroup, TeachingGrade, TeachingStudent } from '@/lib/docente/teaching'
import {
  mergePendingGrades,
  postGrades,
  readPendingGrades,
  writePendingGrades,
  type PendingGrade,
} from '@/lib/docente/grade-outbox'
import { formatNumber, type Locale } from '@/lib/format'
import { downloadCsv } from '@/lib/backoffice/csv'
import { gradeReportCsv } from '@/lib/backoffice/grade-report'
import { EmptyState, StatusBadge, TableShell, tdClass, thClass } from '@/components/backoffice/ui'
import { classGroupTone } from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ClassResources } from '../class-resources'
import { DA_MARK, gradeSheet, isDa, parseGrade, type GradeSheetRow } from '@/lib/grade-sheet'
import { BatchGrades, type BatchEntry } from '../batch-grades'
import { ClassGroupFacts } from '../class-group-facts'
import { ClassNotices } from '../class-notices'

/**
 * Which of the class group's tools are on the air. Each one is a feature flag
 * (`teacher.grades`, `teacher.class_links`, `teacher.notices`). Grades are
 * posted to the API since OOC-38; notices still write only on this screen and
 * stay off in production — nothing "saved only here" may reach a teacher
 * (OOC-82). The class links read the API since OOC-98.
 */
export interface WorkspaceTools {
  grades: boolean
  classLinks: boolean
  notices: boolean
}

/**
 * One of the teacher's class groups: what it is and when it meets, and who is
 * in it — read from `apps/api`, scoped by the session (CLAUDE.md §8). Names,
 * never personal data: no document, no contact, no payment.
 *
 * Behind the flags, the tools from PR #136 keep their screen for us: the
 * grade sheet (final exam grade, DA, batch, observations, the CSV report) and
 * the notices. Their writes are screen state until their tickets give them a
 * usecase that compares the authenticated `teacher_id` with the class group
 * (OOC-38, OOC-102). The class's links are read-only and real: the Classroom
 * (OOC-98); the module material waits for OOC-100.
 */
export function ClassGroupWorkspace({
  group,
  students,
  teacherName,
  tools,
  passingGrade,
  grades,
}: {
  group: TeachingClassGroup
  students: TeachingStudent[]
  teacherName: string
  tools: WorkspaceTools
  /** Minimum final grade, from `platform_settings` (OOC-41). Null when the grade sheet is off or the read failed. */
  passingGrade: number | null
  /** The grades already posted (OOC-38). Null when the sheet is off or the read failed. */
  grades: TeachingGrade[] | null
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const router = useRouter()

  /* Without the posted grades the sheet cannot tell an empty cell from a
     final one — it is not drawn at all rather than drawn wrong. */
  const grading = tools.grades && passingGrade !== null && grades !== null
  const gradesUnavailable = tools.grades && !grading
  const gradingOpen = group.status === 'in_progress' || group.status === 'finished'

  /* What this device confirmed and the API has not acknowledged yet. Read
     from storage after mount — the server render cannot see it. */
  const [pending, setPending] = useState<PendingGrade[]>([])
  /* Posted from here and acknowledged, until the refreshed read brings them. */
  const [acknowledged, setAcknowledged] = useState<TeachingGrade[]>([])
  const [sync, setSync] = useState<'idle' | 'sending' | 'offline'>('idle')
  const [notice, setNotice] = useState<string | null>(null)
  const flushing = useRef(false)

  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  /* Posting is final: the dialog asks once more before it writes. */
  const [confirmingGrade, setConfirmingGrade] = useState(false)
  const [posted, setPosted] = useState<string | null>(null)
  const [batchOpen, setBatchOpen] = useState(false)

  const sheet: GradeSheetRow[] =
    grading && passingGrade !== null
      ? gradeSheet(students, [...(grades ?? []), ...acknowledged], pending, passingGrade)
      : gradeSheet(students, [], [], 0)

  /**
   * Sends everything waiting on the device, once at a time. Kept on no
   * answer; dropped — and the sheet re-read — on any answer, because then the
   * API holds the truth: posted, or refused for a reason the teacher is told.
   */
  const flush = useCallback(async () => {
    const queue = readPendingGrades(group.id)
    if (queue.length === 0 || flushing.current) return
    flushing.current = true
    setSync('sending')
    const result = await postGrades(group.id, queue)
    flushing.current = false

    if (result === 'offline') {
      setSync('offline')
      return
    }

    writePendingGrades(group.id, [])
    setPending([])
    setSync('idle')
    if (result === 'posted' || result === 'finished') {
      const now = new Date().toISOString()
      setAcknowledged((current) => [
        ...current,
        ...queue.map((entry) => ({
          enrollmentId: entry.enrollmentId,
          grade: entry.grade === 'da' ? null : entry.grade,
          didNotSit: entry.grade === 'da',
          recordedAt: now,
          correctedAt: null,
        })),
      ])
      setNotice(null)
      setPosted(
        result === 'finished'
          ? t('class_group_grades.teacher_finished')
          : queue.length === 1
            ? t('class_list.posted_toast')
            : t('class_list.batch_posted', { count: queue.length }),
      )
    } else {
      setNotice(result === 'conflict' ? t('class_group.grades_conflict') : t('class_group.grades_refused'))
    }
    router.refresh()
  }, [group.id, router, t])

  /* Whatever a previous visit left unsent goes out on arrival, again when the
     browser says the connection is back, and every 20 s while it is not —
     a 3G phone often says it is online and still drops the request. */
  useEffect(() => {
    if (!grading) return
    const stored = readPendingGrades(group.id)
    if (stored.length > 0) {
      setPending(stored)
      void flush()
    }
    const onOnline = () => void flush()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [grading, group.id, flush])

  useEffect(() => {
    if (sync !== 'offline') return
    const timer = window.setInterval(() => void flush(), 20_000)
    return () => window.clearInterval(timer)
  }, [sync, flush])

  function enqueue(entries: PendingGrade[]) {
    if (entries.length === 0) return
    const next = mergePendingGrades(readPendingGrades(group.id), entries)
    writePendingGrades(group.id, next)
    setPending(next)
    void flush()
  }

  /* One grade per student: the final exam's, which is the module's grade
     (`docs/REGRAS-NEGOCIO.md` §3). Once posted it is final (decision
     08/10/2026). A cell offers "add" only while empty, in a running or
     finished group. */
  const canAdd = (row: GradeSheetRow) => gradingOpen && row.sync === null

  const editingRow = editing ? (sheet.find((row) => row.enrollmentId === editing) ?? null) : null
  const editValid = editing !== null && parseGrade(editValue) !== null

  function postGrade() {
    if (passingGrade === null || !editing || !(editValid || isDa(editValue))) return
    enqueue([{ enrollmentId: editing, grade: isDa(editValue) ? 'da' : (parseGrade(editValue) as number) }])
    setEditing(null)
    setConfirmingGrade(false)
  }

  const batchRows = sheet.filter(canAdd)

  function postBatch(entries: BatchEntry[]) {
    enqueue(entries.map((entry) => ({ enrollmentId: entry.enrollmentId, grade: entry.grade })))
  }

  const editDisplay = isDa(editValue)
    ? DA_MARK
    : parseGrade(editValue) !== null
      ? formatNumber(parseGrade(editValue) as number, locale)
      : ''

  function downloadReport() {
    const csv = gradeReportCsv(sheet, {
      student: t('grade_report.col_student'),
      grade: t('grade_report.col_exam'),
      status: t('grade_report.col_status'),
      statusOf: (status) => t(`grade_status.${status}`),
    })
    downloadCsv(t('grade_report.file_name', { code: group.code }), csv)
  }

  const columns = grading
    ? [t('grade_report.col_student'), t('grade_report.col_exam')]
    : [t('grade_report.col_student')]

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/docente/class-groups"
        className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-ink"
      >
        <BoIcon name="arrow-left" size={16} />
        {t('class_list.back')}
      </Link>

      {/* 1 — Class group information: what and when on the left, the doors
          to the class on the right when they are on the air. */}
      <section
        className={`grid overflow-hidden rounded-2xl border border-line bg-white ${
          tools.classLinks ? '@4xl/page:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]' : ''
        }`}
      >
        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-ink">{group.courseName}</h1>
              <p className="text-xs text-muted-foreground">
                {`${group.language.name} · ${group.academicPeriodName}`}
              </p>
            </div>
            <StatusBadge
              tone={classGroupTone[group.status]}
              label={t(`class_group_status.${group.status}`)}
            />
            {grading && group.status === 'finished' && (
              <span className="ml-auto">
                <button
                  type="button"
                  onClick={downloadReport}
                  disabled={sheet.length === 0}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-blue transition hover:text-brand-blue-deep disabled:cursor-default disabled:opacity-50"
                >
                  <BoIcon name="download" size={15} />
                  {t('grade_report.download')}
                </button>
              </span>
            )}
          </div>
          <ClassGroupFacts
            group={group}
            className="sm:grid-cols-4 @4xl/page:grid-cols-2 @6xl/page:grid-cols-4"
          />
        </div>

        {tools.classLinks && (
          <aside className="border-t border-line bg-sky-soft/60 px-5 py-4 @4xl/page:border-l @4xl/page:border-t-0">
            <ClassResources
              classroomUrl={group.classroomUrl}
              module={group.module}
              moduleMaterialsUrl={group.moduleMaterialUrl}
              courseMaterialUrls={group.courseMaterialUrls}
            />
          </aside>
        )}
      </section>

      {/* 2 — Students: names; with the grade sheet on, a sheet. */}
      <section className="overflow-hidden rounded-2xl border border-line bg-white">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <BoIcon name="students" size={16} className="text-brand-blue" />
            {t('class_list.students_title', { count: students.length })}
            {grading && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="rounded-full text-muted-foreground transition hover:text-brand-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40"
                  >
                    <BoIcon name="help" size={15} />
                    <span className="sr-only">{t('class_list.grades_locked')}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6}>
                  {t('class_list.grades_locked')}
                </TooltipContent>
              </Tooltip>
            )}
          </h2>
          {grading && batchRows.length > 0 && (
            <button
              type="button"
              onClick={() => setBatchOpen(true)}
              className="inline-flex min-h-tap items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 text-sm font-semibold text-white transition hover:bg-brand-blue-deep sm:min-h-0 sm:py-2"
            >
              <BoIcon name="edit" size={15} />
              {t('class_list.batch_open')}
            </button>
          )}
        </header>

        {grading && !gradingOpen && (
          <p className="border-b border-line px-5 py-2.5 text-xs text-muted-foreground">
            {t('teacher_groups.not_started')}
          </p>
        )}
        {gradesUnavailable && (
          <p className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-5 py-2 text-xs text-red-800">
            <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
            {t('class_group.grades_load_error')}
          </p>
        )}
        {grading && pending.length > 0 && (
          <p
            role="status"
            className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-800"
          >
            <BoIcon name={sync === 'sending' ? 'spinner' : 'clock'} size={14} className="shrink-0" />
            <span className="flex-1">
              {sync === 'sending'
                ? t('class_group.grades_sending', { count: pending.length })
                : t('class_group.grades_pending_offline', { count: pending.length })}
            </span>
            {sync === 'offline' && (
              <button
                type="button"
                onClick={() => void flush()}
                className="inline-flex min-h-tap items-center gap-1 font-semibold text-amber-900 underline-offset-2 hover:underline sm:min-h-0"
              >
                <BoIcon name="refresh" size={13} />
                {t('class_group.grades_retry')}
              </button>
            )}
          </p>
        )}
        {grading && notice && (
          <p role="alert" className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-5 py-2 text-xs text-red-800">
            <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
            {notice}
          </p>
        )}

        {students.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon="students"
              title={t('class_group.empty_roster_title')}
              body={t('class_group.empty_roster_body')}
            />
          </div>
        ) : (
          <TableShell columns={columns}>
            <thead>
              <tr>
                {columns.map((label) => (
                  <th key={label} className={thClass}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.map((row) => (
                <tr key={row.enrollmentId}>
                  <td className={tdClass}>
                    <span className="font-semibold text-ink">{row.fullName}</span>
                  </td>
                  {grading && passingGrade !== null && (
                    <td className={tdClass}>
                      <span className="inline-flex items-center gap-1.5">
                        {row.gradeStatus === 'auto_failed' ? (
                          <span className="font-semibold text-red-700">{DA_MARK}</span>
                        ) : row.finalGrade !== null ? (
                          <span
                            className={`font-semibold tabular-nums ${
                              row.finalGrade >= passingGrade ? 'text-ink' : 'text-red-700'
                            }`}
                          >
                            {formatNumber(row.finalGrade, locale)}
                          </span>
                        ) : canAdd(row) ? (
                          <AddGradeButton
                            label={t('class_list.add_grade')}
                            onClick={() => {
                              setEditing(row.enrollmentId)
                              setEditValue('')
                              setConfirmingGrade(false)
                            }}
                          />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                        {/* The supervision corrected it (OOC-102): the value shown is the correction's. */}
                        {row.corrected && (
                          <span className="rounded-full bg-sky px-2 py-0.5 text-[11px] font-semibold text-brand-blue-deep">
                            {t('class_group_grades.teacher_corrected')}
                          </span>
                        )}
                        {/* Confirmed here, not yet acknowledged by the API. */}
                        {row.sync === 'pending' && (
                          <span title={t('class_group.grade_pending_sync')} className="text-amber-600">
                            <BoIcon name="clock" size={13} />
                            <span className="sr-only">{t('class_group.grade_pending_sync')}</span>
                          </span>
                        )}
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </section>

      {/* 3 — Notices: their own card, with the history of what was sent. */}
      {tools.notices && (
        <ClassNotices key={`notices-${group.id}`} initialNotices={[]} teacherName={teacherName} canPost />
      )}

      {grading && passingGrade !== null && (
        <>
          {/* Posting one grade. The dialog is the confirmation: it says, before
              the click, that a posted grade cannot be changed. */}
          <Dialog open={editing !== null} onOpenChange={(next) => !next && setEditing(null)}>
            <DialogContent closeLabel={t('agenda.close')} className="sm:max-w-sm">
              {editingRow && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (editValid) setConfirmingGrade(true)
                  }}
                  className="flex flex-col gap-1"
                >
                  <DialogHeader>
                    <DialogTitle>
                      {confirmingGrade
                        ? t('class_list.confirm_grade_title')
                        : t('class_list.add_grade_title')}
                    </DialogTitle>
                    <DialogDescription>
                      {t('class_list.student_label', { name: editingRow.fullName })}
                    </DialogDescription>
                  </DialogHeader>
                  {confirmingGrade ? (
                    <>
                      <div className="flex flex-col items-center gap-3 px-4 pb-1 pt-2 text-center">
                        <span
                          className={`grid min-w-24 place-items-center rounded-2xl px-5 py-4 text-4xl font-bold tabular-nums ${
                            isDa(editValue) ? 'bg-red-50 text-red-700' : 'bg-sky text-brand-blue-deep'
                          }`}
                        >
                          {editDisplay}
                        </span>
                        <StatusBadge
                          tone={
                            isDa(editValue)
                              ? 'danger'
                              : (parseGrade(editValue) ?? 0) >= passingGrade
                                ? 'success'
                                : 'danger'
                          }
                          label={
                            isDa(editValue)
                              ? t('class_list.did_not_sit')
                              : (parseGrade(editValue) ?? 0) >= passingGrade
                                ? t('grade_status.approved')
                                : t('grade_status.failed')
                          }
                        />
                        <p className="flex items-center gap-1.5 text-xs text-amber-700">
                          <BoIcon name="alert" size={13} className="shrink-0" />
                          {t('class_list.final_warning')}
                        </p>
                      </div>
                      <DialogFooter className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmingGrade(false)}
                          className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
                        >
                          {t('class_list.back_to_edit')}
                        </button>
                        <button
                          type="button"
                          onClick={postGrade}
                          className="rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep"
                        >
                          {t('class_list.confirm_cta')}
                        </button>
                      </DialogFooter>
                    </>
                  ) : (
                    <>
                      <div className="flex flex-col items-center gap-3 px-4 pt-2">
                        <input
                          autoFocus
                          type="text"
                          inputMode="decimal"
                          maxLength={5}
                          value={editValue}
                          onChange={(event) => setEditValue(event.target.value)}
                          aria-label={t('grade_report.col_exam')}
                          placeholder={t('class_list.placeholder_grade')}
                          className="w-32 rounded-lg border border-line bg-white px-3 py-2.5 text-center text-xl font-semibold tabular-nums text-ink outline-none transition placeholder:text-sm placeholder:font-normal placeholder:text-muted-foreground/60 focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
                        />
                        {/* DA — the final exam not sat — is a button, not a code
                            the teacher has to know to type. */}
                        <button
                          type="button"
                          onClick={() => {
                            setEditValue(DA_MARK)
                            setConfirmingGrade(true)
                          }}
                          className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-muted-foreground transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                        >
                          {t('class_list.did_not_sit')}
                        </button>
                        <p className="flex w-full items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
                          {t('class_list.final_warning')}
                        </p>
                      </div>
                      <DialogFooter className="sm:flex-row sm:justify-end">
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
                        >
                          {t('class_list.cancel')}
                        </button>
                        <button
                          type="submit"
                          disabled={!editValid}
                          className="rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-default disabled:opacity-50"
                        >
                          {t('class_list.post')}
                        </button>
                      </DialogFooter>
                    </>
                  )}
                </form>
              )}
            </DialogContent>
          </Dialog>

          <BatchGrades
            key={batchOpen ? 'open' : 'closed'}
            classGroupId={group.id}
            open={batchOpen}
            onOpenChange={setBatchOpen}
            students={batchRows}
            onPost={postBatch}
          />

          <PostedOverlay message={posted} onDone={() => setPosted(null)} />
        </>
      )}
    </div>
  )
}

/** The empty cell's door: "add" a grade, never a raw input that looks editable. */
function AddGradeButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-lg border border-dashed border-brand-blue/50 px-2.5 py-1 text-xs font-semibold text-brand-blue transition hover:border-brand-blue hover:bg-sky-soft"
    >
      <BoIcon name="plus" size={13} />
      {label}
    </button>
  )
}

/**
 * "Grade posted", over the whole screen for about a second. A posted grade is
 * final, so the confirmation that it went through is not a corner toast that
 * can be missed.
 */
function PostedOverlay({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(onDone, 1100)
    return () => window.clearTimeout(timer)
  }, [message, onDone])

  if (!message) return null
  return (
    <div
      role="status"
      aria-live="polite"
      onClick={onDone}
      className="fixed inset-0 z-[60] grid place-items-center bg-ink/30 backdrop-blur-sm animate-in fade-in-0"
    >
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-white px-10 py-8 shadow-xl animate-in zoom-in-95">
        <span className="grid size-16 place-items-center rounded-full bg-emerald-100 text-emerald-600">
          <BoIcon name="check" size={32} />
        </span>
        <p className="text-base font-semibold text-ink">{message}</p>
      </div>
    </div>
  )
}
