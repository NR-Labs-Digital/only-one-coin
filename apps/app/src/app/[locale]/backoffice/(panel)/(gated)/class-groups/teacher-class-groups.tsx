'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type {
  ClassGroupDetail,
  ClassGroupStudent,
  GradeStatus,
} from '@/lib/backoffice/types'
import { PASSING_GRADE } from '@/lib/backoffice/mock-data'
import { formatDate, formatDateTime, type Locale } from '@/lib/format'
import { EmptyState, StatusBadge } from '@/components/backoffice/ui'
import {
  classGroupTone,
  enrollmentTone,
  examTone,
  gradeTone,
  paymentTone,
} from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'

/**
 * The teacher's working screen: every class group of theirs as a browser-style
 * tab, and under the open tab the whole management of that group, student by
 * student — the roster on one side, the selected student on the other with
 * their grades (final exam + closing grade + the DA mark,
 * `docs/REGRAS-NEGOCIO.md` §3) and the teacher's dated observations.
 *
 * One page on purpose: switching turma is a tab, never a navigation
 * round-trip. Certificates stay on the class group's own page — issuing is a
 * batch with a deadline, not per-student management — and the tab links there.
 *
 * Every write is screen-local state, like the rest of the mock: the real
 * write is a usecase in `apps/api` that compares the authenticated
 * `teacher_id` against the class group and leaves an audit entry
 * (CLAUDE.md §8).
 */

/** What the two grade inputs hold before saving — strings while typed. */
interface GradeDraft {
  exam: string
  final: string
  da: boolean
}

/** Integer on the 0–20 Peruvian scale, or null for anything else typed. */
function parseGrade(raw: string): number | null {
  if (!/^\d{1,2}$/.test(raw)) return null
  const value = Number(raw)
  return value <= 20 ? value : null
}

function statusOf(draft: GradeDraft): GradeStatus {
  if (draft.da) return 'auto_failed'
  const grade = parseGrade(draft.final)
  if (grade === null) return 'pending'
  return grade >= PASSING_GRADE ? 'approved' : 'failed'
}

function draftOf(student: ClassGroupStudent): GradeDraft {
  return {
    exam: student.examGrade === null ? '' : String(student.examGrade),
    final: student.finalGrade === null ? '' : String(student.finalGrade),
    da: student.gradeStatus === 'auto_failed',
  }
}

function invalidGrade(raw: string): boolean {
  return raw !== '' && parseGrade(raw) === null
}

/** Tab order: what is being taught first, then what still owes work. */
const statusOrder: Record<ClassGroupDetail['status'], number> = {
  in_progress: 0,
  finished: 1,
  enrolling: 2,
  closed: 3,
}

const gradeInputClass = (invalid: boolean) =>
  `w-16 rounded-lg border bg-white px-2.5 py-1.5 text-center text-sm tabular-nums text-ink outline-none transition focus:ring-2 disabled:bg-slate-50 disabled:text-muted-foreground ${
    invalid
      ? 'border-red-400 focus:border-red-500 focus:ring-red-500/15'
      : 'border-line focus:border-brand-blue focus:ring-brand-blue/15'
  }`

export function TeacherClassGroups({
  groups,
  teacherName,
  initialGroupId,
}: {
  groups: ClassGroupDetail[]
  teacherName: string
  initialGroupId: string | null
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  const ordered = [...groups].sort(
    (a, b) =>
      statusOrder[a.status] - statusOrder[b.status] ||
      b.startDate.localeCompare(a.startDate),
  )

  const [activeId, setActiveId] = useState<string>(
    ordered.some((group) => group.id === initialGroupId)
      ? (initialGroupId as string)
      : (ordered[0]?.id ?? ''),
  )
  /* The rosters are the screen's working copy — grades and notes land here. */
  const [rosters, setRosters] = useState<Record<string, ClassGroupStudent[]>>(
    () => Object.fromEntries(groups.map((group) => [group.id, group.students])),
  )
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<Record<string, GradeDraft>>({})
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({})
  const [savedAt, setSavedAt] = useState<Record<string, string>>({})

  if (ordered.length === 0) {
    return (
      <EmptyState
        icon="courses"
        title={t('teacher_home.no_class_groups_title')}
        body={t('teacher_home.no_class_groups_body')}
      />
    )
  }

  const group = ordered.find((item) => item.id === activeId) ?? ordered[0]
  const roster = rosters[group.id] ?? []
  const student =
    roster.find((item) => item.studentId === selected[group.id]) ?? roster[0]

  const grading = group.status === 'in_progress' || group.status === 'finished'
  const editable =
    student !== undefined &&
    grading &&
    student.certificateIssuedAt === null &&
    student.procedure === null

  const draftKey = student ? `${group.id}:${student.studentId}` : ''
  const draft = student ? (drafts[draftKey] ?? draftOf(student)) : null
  const draftInvalid =
    draft !== null &&
    !draft.da &&
    (invalidGrade(draft.exam) || invalidGrade(draft.final))
  const draftChanged =
    student !== undefined &&
    draft !== null &&
    (draft.da !== (student.gradeStatus === 'auto_failed') ||
      (draft.da ? null : parseGrade(draft.exam)) !== student.examGrade ||
      (draft.da ? null : parseGrade(draft.final)) !== student.finalGrade)

  function pendingOf(id: string): number {
    const item = ordered.find((entry) => entry.id === id)
    if (!item || (item.status !== 'in_progress' && item.status !== 'finished'))
      return 0
    return (rosters[id] ?? []).filter(
      (row) => row.gradeStatus === 'pending' && row.procedure === null,
    ).length
  }

  function setDraft(next: GradeDraft) {
    setDrafts((current) => ({ ...current, [draftKey]: next }))
  }

  function updateStudent(update: (row: ClassGroupStudent) => ClassGroupStudent) {
    if (!student) return
    setRosters((current) => ({
      ...current,
      [group.id]: (current[group.id] ?? []).map((row) =>
        row.studentId === student.studentId ? update(row) : row,
      ),
    }))
  }

  function saveGrades() {
    if (!student || !draft || draftInvalid || !draftChanged) return
    updateStudent((row) => ({
      ...row,
      examGrade: draft.da ? null : parseGrade(draft.exam),
      finalGrade: draft.da ? null : parseGrade(draft.final),
      gradeStatus: statusOf(draft),
    }))
    setDrafts((current) => {
      const rest = { ...current }
      delete rest[draftKey]
      return rest
    })
    setSavedAt((current) => ({ ...current, [draftKey]: new Date().toISOString() }))
  }

  function addNote() {
    const text = (noteDrafts[draftKey] ?? '').trim()
    if (!student || text === '') return
    updateStudent((row) => ({
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
    }))
    setNoteDrafts((current) => ({ ...current, [draftKey]: '' }))
  }

  return (
    <div className="flex flex-col">
      {/* Browser-style tabs: the strip sits on the panel's top border, and the
          open tab merges with it — same background, shared edge. */}
      <div
        role="tablist"
        aria-label={t('nav.my_class_groups')}
        className="flex items-end gap-1 overflow-x-auto px-2"
      >
        {ordered.map((item) => {
          const active = item.id === group.id
          const pending = pendingOf(item.id)
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveId(item.id)}
              className={`relative z-10 -mb-px flex max-w-56 shrink-0 items-center gap-2 rounded-t-xl border px-4 py-2.5 text-sm font-semibold transition ${
                active
                  ? 'border-line border-b-white bg-white text-ink'
                  : 'border-transparent text-muted-foreground hover:bg-white/70 hover:text-ink'
              }`}
            >
              <span className="truncate">{item.courseName}</span>
              {pending > 0 && (
                <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-amber-100 px-1 text-[11px] font-bold tabular-nums text-amber-700">
                  {pending}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <section className="rounded-2xl border border-line bg-white">
        {/* The open group's header: what it is, when it runs, and the door to
            the certificate batch — issuing is not per-student management. */}
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-ink">
              {group.courseName}
            </h2>
            <p className="text-xs tabular-nums text-muted-foreground">
              {`${group.code} · ${group.weekdays.map((day) => t(`weekday.${day}`)).join('/')} · ${group.startTime}`}
            </p>
          </div>
          <StatusBadge
            tone={classGroupTone[group.status]}
            label={t(`class_group_status.${group.status}`)}
          />
          <span className="text-xs text-muted-foreground">
            {`${formatDate(group.startDate, locale)} — ${formatDate(group.endDate, locale)}`}
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {t('seats.taken', { taken: group.seatsTaken, capacity: group.capacity })}
          </span>
          <Link
            href={`/backoffice/class-groups/${group.id}`}
            className="ml-auto inline-flex items-center gap-1.5 text-sm font-semibold text-brand-blue transition hover:text-brand-blue-deep"
          >
            <BoIcon name="doc" size={15} />
            {t('teacher_groups.certificates_link')}
          </Link>
        </header>

        {roster.length === 0 || !student || !draft ? (
          <div className="p-5">
            <EmptyState
              icon="students"
              title={t('class_group.empty_roster_title')}
              body={t('class_group.empty_roster_body')}
            />
          </div>
        ) : (
          <div className="grid gap-0 @3xl/page:grid-cols-[minmax(15rem,1fr)_2fr]">
            {/* Roster: one row per student, the row says what still needs the
                teacher — the grade status and how many observations exist. */}
            <ul className="flex flex-col gap-1 border-b border-line p-3 @3xl/page:border-b-0 @3xl/page:border-r">
              {roster.map((row) => {
                const current = row.studentId === student.studentId
                return (
                  <li key={row.studentId}>
                    <button
                      type="button"
                      onClick={() =>
                        setSelected((prev) => ({
                          ...prev,
                          [group.id]: row.studentId,
                        }))
                      }
                      className={`flex w-full flex-col gap-1 rounded-xl border px-3 py-2.5 text-left transition ${
                        current
                          ? 'border-brand-blue bg-sky'
                          : 'border-transparent hover:bg-sky-soft'
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-ink">
                          {row.fullName}
                        </span>
                        {row.notes.length > 0 && (
                          <span className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
                            <BoIcon name="edit" size={12} />
                            {row.notes.length}
                          </span>
                        )}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge
                          tone={gradeTone[row.gradeStatus]}
                          label={t(`grade_status.${row.gradeStatus}`)}
                        />
                        {row.procedure && (
                          <StatusBadge
                            tone="neutral"
                            label={t(`enrollment_procedure.${row.procedure}`)}
                          />
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>

            {/* The selected student: identity, the grades, the observations. */}
            <div className="flex min-w-0 flex-col gap-5 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-ink">
                  {student.fullName}
                </h3>
                <StatusBadge
                  tone={enrollmentTone[student.enrollmentStatus]}
                  label={t(`enrollment_status.${student.enrollmentStatus}`)}
                />
                <StatusBadge
                  tone={paymentTone[student.paymentStatus]}
                  label={t(`payment_status.${student.paymentStatus}`)}
                />
              </div>

              <section className="rounded-xl border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <BoIcon name="check" size={15} className="text-brand-blue" />
                    {t('teacher_groups.grades_title')}
                  </h4>
                  <StatusBadge
                    tone={gradeTone[statusOf(draft)]}
                    label={t(`grade_status.${statusOf(draft)}`)}
                  />
                </div>

                {!grading ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {group.status === 'enrolling'
                      ? t('teacher_groups.not_started')
                      : t('teacher_groups.closed_readonly')}
                  </p>
                ) : (
                  <>
                    <div className="mt-4 flex flex-wrap items-end gap-x-5 gap-y-3">
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {t('teacher_groups.exam_grade_label')}
                        </span>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={2}
                          value={draft.exam}
                          disabled={!editable || draft.da}
                          onChange={(event) =>
                            setDraft({ ...draft, exam: event.target.value.trim() })
                          }
                          className={gradeInputClass(invalidGrade(draft.exam))}
                        />
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {t('teacher_groups.final_grade_label')}
                        </span>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={2}
                          value={draft.final}
                          disabled={!editable || draft.da}
                          onChange={(event) =>
                            setDraft({ ...draft, final: event.target.value.trim() })
                          }
                          className={gradeInputClass(invalidGrade(draft.final))}
                        />
                      </label>
                      <button
                        type="button"
                        aria-pressed={draft.da}
                        disabled={!editable}
                        onClick={() => setDraft({ ...draft, da: !draft.da })}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                          draft.da
                            ? 'border-red-200 bg-red-50 text-red-700'
                            : 'border-line bg-white text-muted-foreground hover:text-ink'
                        }`}
                      >
                        {t('class_group.grades_da')}
                      </button>
                      {editable && (
                        <button
                          type="button"
                          onClick={saveGrades}
                          disabled={!draftChanged || draftInvalid}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-default disabled:opacity-50"
                        >
                          <BoIcon name="check" size={15} />
                          {t('teacher_groups.save')}
                        </button>
                      )}
                    </div>

                    <p className="mt-3 text-xs text-muted-foreground">
                      {t('class_group.grades_hint', { min: PASSING_GRADE })}
                    </p>
                    {!editable && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {student.certificateIssuedAt !== null
                          ? t('teacher_groups.locked_certificate')
                          : student.procedure !== null
                            ? t('teacher_groups.locked_procedure')
                            : null}
                      </p>
                    )}
                    {draftInvalid && (
                      <p className="mt-2 text-xs font-semibold text-red-600">
                        {t('class_group.grades_invalid')}
                      </p>
                    )}
                    {savedAt[draftKey] && (
                      <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
                        {t('class_group.grades_saved_local_only', {
                          time: formatDateTime(savedAt[draftKey], locale),
                        })}
                      </p>
                    )}
                  </>
                )}

                {group.certificateRule === 'exam_required' &&
                  student.certificationExam && (
                    <p className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs text-muted-foreground">
                      {t('class_group.col_exam')}
                      <StatusBadge
                        tone={examTone[student.certificationExam]}
                        label={t(`exam_status.${student.certificationExam}`)}
                      />
                    </p>
                  )}
              </section>

              <section className="rounded-xl border border-line p-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <BoIcon name="edit" size={15} className="text-brand-blue" />
                  {t('teacher_groups.notes_title')}
                </h4>

                <div className="mt-3 flex flex-col gap-2">
                  <textarea
                    rows={2}
                    value={noteDrafts[draftKey] ?? ''}
                    onChange={(event) =>
                      setNoteDrafts((current) => ({
                        ...current,
                        [draftKey]: event.target.value,
                      }))
                    }
                    placeholder={t('teacher_groups.notes_placeholder', {
                      name: student.fullName,
                    })}
                    className="w-full resize-y rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted-foreground/70 focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
                  />
                  <button
                    type="button"
                    onClick={addNote}
                    disabled={(noteDrafts[draftKey] ?? '').trim() === ''}
                    className="self-end rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:text-brand-blue disabled:cursor-default disabled:opacity-50"
                  >
                    {t('teacher_groups.notes_add')}
                  </button>
                </div>

                {student.notes.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t('teacher_groups.notes_empty')}
                  </p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-2.5">
                    {student.notes.map((note) => (
                      <li
                        key={note.id}
                        className="rounded-lg bg-sky-soft px-3 py-2.5"
                      >
                        <p className="text-sm leading-relaxed text-ink">
                          {note.text}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {`${note.authorName} · ${formatDateTime(note.at, locale)}`}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
