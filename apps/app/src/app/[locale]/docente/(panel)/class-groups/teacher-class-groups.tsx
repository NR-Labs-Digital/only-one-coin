'use client'

import { useEffect, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type {
  ClassGroupDetail,
  ClassGroupStudent,
} from '@/lib/backoffice/types'
import { formatDateTime, formatNumber, type Locale } from '@/lib/format'
import {
  EmptyState,
  StatusBadge,
  TableShell,
  tdClass,
  thClass,
} from '@/components/backoffice/ui'
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ClassResources } from './class-resources'
import { DA_MARK, finalStatus, isDa, parseGrade } from './grade-sheet'
import { BatchGrades, type BatchEntry } from './batch-grades'
import { ClassGroupFacts } from './class-group-facts'
import { ClassNotices } from './class-notices'
import { downloadCsv, gradeReportCsv } from '@/lib/backoffice/grade-report'

/**
 * The teacher's working screen. First the list of their class groups (see
 * `ClassGroupList`); open one and it splits in two:
 *
 * - **Class group information** — what it is, when it runs, the links and the
 *   module's material, the students' Classroom, the notices.
 * - **Students** — a table, one row per student, with the grades typed right
 *   in the row (final exam + closing grade + the DA mark,
 *   `docs/REGRAS-NEGOCIO.md` §3) and the teacher's observations one click
 *   away in a side sheet.
 *
 * Names, never personal data: the teacher reads who is in the class and how
 * they are doing — no document, no contact, no payment. Money is billing's,
 * and a roster row is not the student's ficha.
 *
 * Every write is screen-local state, like the rest of the mock: the real
 * write is a usecase in `apps/api` that compares the authenticated
 * `teacher_id` against the class group and leaves an audit entry
 * (CLAUDE.md §8).
 */

/** List order: what is being taught first, then what still owes work. */
const statusOrder: Record<ClassGroupDetail['status'], number> = {
  in_progress: 0,
  finished: 1,
  enrolling: 2,
  closed: 3,
  // A draft is not on sale and has no roster; the mock never produces one, and
  // if a real one ever reaches a teacher it goes last.
  draft: 4,
}

export function TeacherClassGroups({
  groups,
  teacherName,
  passingGrade,
}: {
  groups: ClassGroupDetail[]
  teacherName: string
  /** Minimum final grade, from `platform_settings` (OOC-41). */
  passingGrade: number
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const ordered = [...groups].sort(
    (a, b) =>
      statusOrder[a.status] - statusOrder[b.status] ||
      b.startDate.localeCompare(a.startDate),
  )

  /* The open class group lives in the URL (`?group=`), so the browser's back
     button returns to the list and the home's links land on the right group.
     Pushed with the native history API: Next keeps `useSearchParams` in sync
     without a server round-trip, and the working copy below survives. */
  const requested = searchParams.get('group')
  const activeId = ordered.some((group) => group.id === requested) ? requested : null

  /* The rosters are the screen's working copy — grades and notes land here. */
  const [rosters, setRosters] = useState<Record<string, ClassGroupStudent[]>>(
    () => Object.fromEntries(groups.map((group) => [group.id, group.students])),
  )
  /* The cell being filled in the post-a-grade dialog, and what is typed. */
  /* The student whose final-exam grade is being posted. */
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  /* Posting is final: the dialog asks once more before it writes. */
  const [confirmingGrade, setConfirmingGrade] = useState(false)
  const [posted, setPosted] = useState<string | null>(null)
  const [batchOpen, setBatchOpen] = useState(false)
  const [savedAt, setSavedAt] = useState<Record<string, string>>({})
  /* The student whose observations are open in the side sheet. */
  const [notesFor, setNotesFor] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')

  if (ordered.length === 0) {
    return (
      <EmptyState
        icon="courses"
        title={t('teacher_home.no_class_groups_title')}
        body={t('teacher_home.no_class_groups_body')}
      />
    )
  }

  function open(id: string | null) {
    window.history.pushState(null, '', id ? `${pathname}?group=${id}` : pathname)
  }

  function pendingOf(id: string): number {
    const item = ordered.find((entry) => entry.id === id)
    if (!item || (item.status !== 'in_progress' && item.status !== 'finished'))
      return 0
    return (rosters[id] ?? []).filter(
      (row) => row.gradeStatus === 'pending' && row.procedure === null,
    ).length
  }

  if (activeId === null) {
    return (
      <ClassGroupList
        groups={ordered}
        onOpen={open}
        pendingOf={pendingOf}
      />
    )
  }

  const group = ordered.find((item) => item.id === activeId) ?? ordered[0]
  const roster = rosters[group.id] ?? []
  const grading = group.status === 'in_progress' || group.status === 'finished'
  /* The report closes a finished group: the grades as they stand, names only. */
  const reportable = group.status === 'finished' || group.status === 'closed'

  /* One grade per student: the final exam's, which is the module's grade
     (`docs/REGRAS-NEGOCIO.md` §3 — even the make-up exam "becomes the final
     grade of the module"). Once posted it is final — the sheet is a record,
     not a draft (decision 08/10/2026). A cell offers "add" only while it is
     empty, on a student still in the class, in a running or finished group. */
  const canAdd = (student: ClassGroupStudent) =>
    grading &&
    student.certificateIssuedAt === null &&
    student.procedure === null &&
    student.gradeStatus === 'pending'

  const editingStudent = editing
    ? (roster.find((row) => row.studentId === editing) ?? null)
    : null
  const editValid = editing !== null && parseGrade(editValue) !== null

  function startEditing(student: ClassGroupStudent) {
    setEditing(student.studentId)
    setEditValue('')
    setConfirmingGrade(false)
  }

  function postGrade() {
    if (!editing || !(editValid || isDa(editValue))) return
    setRosters((current) => ({
      ...current,
      [group.id]: (current[group.id] ?? []).map((row) => {
        if (row.studentId !== editing) return row
        if (isDa(editValue)) return { ...row, finalGrade: null, gradeStatus: 'auto_failed' }
        const grade = parseGrade(editValue) as number
        return { ...row, finalGrade: grade, gradeStatus: finalStatus(grade, passingGrade) }
      }),
    }))
    setEditing(null)
    setConfirmingGrade(false)
    setPosted(t('class_list.posted_toast'))
    setSavedAt((current) => ({ ...current, [group.id]: new Date().toISOString() }))
  }

  const batchStudents = roster.filter(canAdd)

  function postBatch(entries: BatchEntry[]) {
    const byId = new Map(entries.map((entry) => [entry.studentId, entry]))
    setRosters((current) => ({
      ...current,
      [group.id]: (current[group.id] ?? []).map((row) => {
        const entry = byId.get(row.studentId)
        if (!entry) return row
        if (row.gradeStatus !== 'pending') return row
        if (entry.grade === 'da') return { ...row, finalGrade: null, gradeStatus: 'auto_failed' }
        return { ...row, finalGrade: entry.grade, gradeStatus: finalStatus(entry.grade, passingGrade) }
      }),
    }))
    setPosted(t('class_list.batch_posted', { count: entries.length }))
    setSavedAt((current) => ({ ...current, [group.id]: new Date().toISOString() }))
  }

  /* What the confirmation repeats back: the grade as the reader writes
     numbers, or the DA mark. */
  const editDisplay = isDa(editValue)
    ? DA_MARK
    : parseGrade(editValue) !== null
      ? formatNumber(parseGrade(editValue) as number, locale)
      : ''

  function downloadReport() {
    const csv = gradeReportCsv(roster, {
      student: t('grade_report.col_student'),
      grade: t('grade_report.col_exam'),
      status: t('grade_report.col_status'),
      statusOf: (status) => t(`grade_status.${status}`),
    })
    downloadCsv(t('grade_report.file_name', { code: group.code }), csv)
  }

  const notesStudent = roster.find((row) => row.studentId === notesFor) ?? null

  function addNote() {
    const text = noteDraft.trim()
    if (!notesStudent || text === '') return
    setRosters((current) => ({
      ...current,
      [group.id]: (current[group.id] ?? []).map((row) =>
        row.studentId === notesStudent.studentId
          ? {
              ...row,
              notes: [
                {
                  id: `note_local_${Date.now()}`,
                  at: new Date().toISOString(),
                  authorName: teacherName,
                  text,
                },
                ...row.notes,
              ],
            }
          : row,
      ),
    }))
    setNoteDraft('')
  }

  const columns = [
    t('grade_report.col_student'),
    t('grade_report.col_exam'),
    t('teacher_groups.notes_title'),
  ]

  return (
    <div className="flex flex-col gap-5">
      {/* Back to the list — the tab strip it replaces could not tell two
          "Inglés Básico" apart, nor hold four groups in two languages. */}
      <button
        type="button"
        onClick={() => open(null)}
        className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-ink"
      >
        <BoIcon name="arrow-left" size={16} />
        {t('class_list.back')}
      </button>

      {/* 1 — Class group information: what and when on the left, the doors
          to the class on the right — the width is used, not left empty. */}
      <section className="grid overflow-hidden rounded-2xl border border-line bg-white @4xl/page:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-ink">{group.courseName}</h2>
              {group.moduleNumber && (
                <p className="text-xs text-muted-foreground">
                  {t('class_list.module', { module: group.moduleNumber })}
                </p>
              )}
            </div>
            <StatusBadge
              tone={classGroupTone[group.status]}
              label={t(`class_group_status.${group.status}`)}
            />
            {/* Closing the module is the only moment these two matter. */}
            {reportable && (
              <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
                <button
                  type="button"
                  onClick={downloadReport}
                  disabled={roster.length === 0}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-blue transition hover:text-brand-blue-deep disabled:cursor-default disabled:opacity-50"
                >
                  <BoIcon name="download" size={15} />
                  {t('grade_report.download')}
                </button>
                <Link
                  href={`/docente/class-groups/${group.id}`}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-blue transition hover:text-brand-blue-deep"
                >
                  <BoIcon name="doc" size={15} />
                  {t('teacher_groups.certificates_link')}
                </Link>
              </span>
            )}
          </div>
          {/* Code (copyable), days and time, module start and end — each
              under its own label instead of one dot-joined line. */}
          <ClassGroupFacts group={group} className="sm:grid-cols-4 @4xl/page:grid-cols-2 @6xl/page:grid-cols-4" />
        </div>

        <aside className="border-t border-line bg-sky-soft/60 px-5 py-4 @4xl/page:border-l @4xl/page:border-t-0">
          <ClassResources key={group.id} group={group} />
        </aside>
      </section>

      {/* 2 — Students: a grade sheet. Open cells while pending, plain text
          once posted. */}
      <section className="overflow-hidden rounded-2xl border border-line bg-white">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <BoIcon name="students" size={16} className="text-brand-blue" />
            {t('class_list.students_title', {
              count: roster.filter((row) => row.procedure === null).length,
            })}
            {/* The one rule worth saying, folded into a `?` instead of a
                sentence over the sheet. */}
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
          </h2>
          {batchStudents.length > 0 && (
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

        {!grading && (
          <p className="border-b border-line px-5 py-2.5 text-xs text-muted-foreground">
            {group.status === 'enrolling'
              ? t('teacher_groups.not_started')
              : t('teacher_groups.closed_readonly')}
          </p>
        )}
        {savedAt[group.id] && (
          <p className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-800">
            <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
            {t('class_group.grades_saved_local_only', {
              time: formatDateTime(savedAt[group.id], locale),
            })}
          </p>
        )}

        {roster.length === 0 ? (
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
              {roster.map((student) => (
                <tr key={student.studentId}>
                  <td className={tdClass}>
                    <span className="flex flex-col">
                      <span className="font-semibold text-ink">{student.fullName}</span>
                      {student.procedure && (
                        <span className="text-xs text-muted-foreground">
                          {t(`enrollment_procedure.${student.procedure}`)}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className={tdClass}>
                    {student.gradeStatus === 'auto_failed' ? (
                      <span className="font-semibold text-red-700">{DA_MARK}</span>
                    ) : student.finalGrade !== null ? (
                      <span
                        className={`font-semibold tabular-nums ${
                          student.finalGrade >= passingGrade ? 'text-ink' : 'text-red-700'
                        }`}
                      >
                        {formatNumber(student.finalGrade, locale)}
                      </span>
                    ) : canAdd(student) ? (
                      <AddGradeButton
                        label={t('class_list.add_grade')}
                        onClick={() => startEditing(student)}
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className={tdClass}>
                    <button
                      type="button"
                      onClick={() => {
                        setNotesFor(student.studentId)
                        setNoteDraft('')
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1 text-xs font-semibold text-ink transition hover:border-brand-blue hover:text-brand-blue"
                    >
                      <BoIcon name="edit" size={13} />
                      {t('class_list.notes_button', { count: student.notes.length })}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </section>

      {/* 3 — Notices: their own card, with the history of what was sent. */}
      <ClassNotices
        key={`notices-${group.id}`}
        initialNotices={group.notices}
        teacherName={teacherName}
        canPost={group.status !== 'closed'}
      />

      {/* Posting one grade. The dialog is the confirmation: it says, before
          the click, that a posted grade cannot be changed. */}
      <Dialog open={editing !== null} onOpenChange={(next) => !next && setEditing(null)}>
        <DialogContent closeLabel={t('agenda.close')} className="sm:max-w-sm">
          {editing && editingStudent && (
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
                  {t('class_list.student_label', { name: editingStudent.fullName })}
                </DialogDescription>
              </DialogHeader>
              {confirmingGrade ? (
                <>
                  {/* The grade, big, is the whole message: what is about to
                      be written and, for a final grade, what it means. */}
                  <div className="flex flex-col items-center gap-3 px-4 pb-1 pt-2 text-center">
                    <span
                      className={`grid min-w-24 place-items-center rounded-2xl px-5 py-4 text-4xl font-bold tabular-nums ${
                        isDa(editValue) ? 'bg-red-50 text-red-700' : 'bg-sky text-brand-blue-deep'
                      }`}
                    >
                      {editDisplay}
                    </span>
                    {(
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
                    )}
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
                    {(
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
                    )}
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

      {/* Observations live a click away: dated, append-only, per student. */}
      <Sheet open={notesStudent !== null} onOpenChange={(next) => !next && setNotesFor(null)}>
        <SheetContent closeLabel={t('agenda.close')} className="gap-0 p-0">
          {notesStudent && (
            <>
              <SheetHeader className="border-b border-line px-5 py-4">
                <SheetTitle>{notesStudent.fullName}</SheetTitle>
                <SheetDescription>{t('teacher_groups.notes_title')}</SheetDescription>
              </SheetHeader>
              <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
                <textarea
                  rows={3}
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  placeholder={t('teacher_groups.notes_placeholder', {
                    name: notesStudent.fullName,
                  })}
                  className="w-full resize-y rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted-foreground/70 focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
                />
                <button
                  type="button"
                  onClick={addNote}
                  disabled={noteDraft.trim() === ''}
                  className="self-end rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-default disabled:opacity-50"
                >
                  {t('teacher_groups.notes_add')}
                </button>
                {notesStudent.notes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('teacher_groups.notes_empty')}</p>
                ) : (
                  <ul className="flex flex-col gap-2.5">
                    {notesStudent.notes.map((note) => (
                      <li key={note.id} className="rounded-lg bg-sky-soft px-3 py-2.5">
                        <p className="text-sm leading-relaxed text-ink">{note.text}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {`${note.authorName} · ${formatDateTime(note.at, locale)}`}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <BatchGrades
        key={`batch-${group.id}`}
        open={batchOpen}
        onOpenChange={setBatchOpen}
        students={batchStudents}
        onPost={postBatch}
      />

      <PostedOverlay message={posted} onDone={() => setPosted(null)} />
    </div>
  )
}

/**
 * The teacher's class groups as cards — what tells one apart from another:
 * course and module, days and time, code, status and what it still owes.
 * Grouped by language once there is more than one, so a teacher with three
 * English groups and an Italian one reads two short lists, not one long row.
 */
function ClassGroupList({
  groups,
  onOpen,
  pendingOf,
}: {
  groups: ClassGroupDetail[]
  onOpen: (id: string) => void
  pendingOf: (id: string) => number
}) {
  const t = useTranslations('bo')

  const shown = groups

  const languages = [
    ...new Map(shown.map((group) => [group.language.id, group.language])).values(),
  ].sort((a, b) => a.name.localeCompare(b.name))
  const byLanguage = languages.length > 1

  const listColumns = [
    t('class_list.col_class'),
    t('class_facts.schedule'),
    t('class_list.col_pending'),
    t('grade_report.col_status'),
    '',
  ]

  return (
    <div className="flex flex-col gap-5">

      {shown.length === 0 ? (
        <EmptyState
          icon="courses"
          title={t('class_list.empty_title')}
          body={t('class_list.empty_body')}
        />
      ) : (
        languages.map((language) => (
          <section key={language.id} className="flex flex-col gap-3">
            {byLanguage && (
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {language.name}
              </h2>
            )}
            {/* Basic facts only — which group, when it meets, what it owes.
                Code, dates and the roster are one click away, inside it. */}
            <div className="overflow-hidden rounded-2xl border border-line bg-white">
              <TableShell columns={listColumns}>
                <thead>
                  <tr>
                    {listColumns.map((label) => (
                      <th key={label} className={thClass}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown
                    .filter((group) => group.language.id === language.id)
                    .map((group) => {
                      const pending = pendingOf(group.id)
                      return (
                        <tr
                          key={group.id}
                          onClick={() => onOpen(group.id)}
                          className="cursor-pointer transition hover:bg-sky-soft"
                        >
                          <td className={tdClass}>
                            {/* The real control for keyboards and screen
                                readers; the row click is a mouse shortcut. */}
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                onOpen(group.id)
                              }}
                              className="flex flex-col text-left"
                            >
                              <span className="font-semibold text-ink">{group.courseName}</span>
                              {group.moduleNumber && (
                                <span className="text-xs text-muted-foreground">
                                  {t('class_list.module', { module: group.moduleNumber })}
                                </span>
                              )}
                            </button>
                          </td>
                          <td className={`${tdClass} whitespace-nowrap tabular-nums`}>
                            {`${group.weekdays.map((day) => t(`weekday.${day}`)).join(' · ')} · ${group.startTime}`}
                          </td>
                          <td className={tdClass}>
                            {pending > 0 ? (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                                {t('class_list.pending_grades', { count: pending })}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className={tdClass}>
                            <StatusBadge
                              tone={classGroupTone[group.status]}
                              label={t(`class_group_status.${group.status}`)}
                            />
                          </td>
                          <td className={`${tdClass} text-right`}>
                            <BoIcon
                              name="chevron-right"
                              size={16}
                              className="inline text-muted-foreground"
                            />
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </TableShell>
            </div>
          </section>
        ))
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
