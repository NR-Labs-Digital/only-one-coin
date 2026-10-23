'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { ClassGroupStudent } from '@/lib/backoffice/types'
import { formatNumber, type Locale } from '@/lib/format'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { BoIcon } from '@/components/backoffice/icons'
import { DA_MARK, parseGrade } from './grade-sheet'

/** What the batch posts for one student — only the cells that were filled. */
export interface BatchEntry {
  studentId: string
  /** The final exam's grade, or `'da'` for the exam not sat. */
  grade: number | 'da'
}

interface RowDraft {
  grade: string
  da: boolean
}

const EMPTY: RowDraft = { grade: '', da: false }

/**
 * Posting a whole class's grades in one go: one row per student who still
 * has an open cell, fill what you have, review, confirm. Same rules as the
 * one-grade dialog — empty cells are skipped, a posted grade is final, DA only
 * while no exam grade exists — and the review step repeats every value before
 * anything is written.
 */
export function BatchGrades({
  open,
  onOpenChange,
  students,
  onPost,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Students whose final-exam grade is still open. */
  students: ClassGroupStudent[]
  onPost: (entries: BatchEntry[]) => void
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const [rows, setRows] = useState<Record<string, RowDraft>>({})
  const [reviewing, setReviewing] = useState(false)

  const rowOf = (id: string) => rows[id] ?? EMPTY

  function update(id: string, next: Partial<RowDraft>) {
    setRows((current) => ({ ...current, [id]: { ...rowOf(id), ...next } }))
  }

  const invalid = (row: RowDraft) =>
    !row.da && row.grade.trim() !== '' && parseGrade(row.grade) === null

  const entries: BatchEntry[] = students.flatMap((student): BatchEntry[] => {
    const row = rowOf(student.studentId)
    if (row.da) return [{ studentId: student.studentId, grade: 'da' as const }]
    const grade = parseGrade(row.grade)
    return grade === null ? [] : [{ studentId: student.studentId, grade }]
  })

  const anyInvalid = students.some((student) => invalid(rowOf(student.studentId)))

  function close() {
    onOpenChange(false)
    setReviewing(false)
    setRows({})
  }

  function confirm() {
    onPost(entries)
    close()
  }

  const nameOf = (id: string) => students.find((s) => s.studentId === id)?.fullName ?? ''

  const cellClass = (invalid: boolean) =>
    `w-20 rounded-lg border bg-white px-2 py-1.5 text-center text-sm tabular-nums text-ink outline-none transition focus:ring-2 disabled:bg-slate-50 disabled:text-slate-400 ${
      invalid
        ? 'border-red-400 focus:border-red-500 focus:ring-red-500/15'
        : 'border-line focus:border-brand-blue focus:ring-brand-blue/15'
    }`

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent closeLabel={t('agenda.close')} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {reviewing ? t('class_list.batch_review_title') : t('class_list.batch_title')}
          </DialogTitle>
          <DialogDescription>
            {reviewing
              ? t('class_list.batch_review_subtitle', { count: entries.length })
              : t('class_list.batch_subtitle')}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto px-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">{t('grade_report.col_student')}</th>
                <th className="py-2 text-center font-medium">{t('grade_report.col_exam')}</th>
              </tr>
            </thead>
            <tbody>
              {reviewing
                ? entries.map((entry) => (
                    <tr key={entry.studentId} className="border-t border-line">
                      <td className="py-2.5 pr-3 font-semibold text-ink">{nameOf(entry.studentId)}</td>
                      <td
                        className={`py-2.5 text-center font-semibold tabular-nums ${
                          entry.grade === 'da' ? 'text-red-700' : 'text-ink'
                        }`}
                      >
                        {entry.grade === 'da' ? DA_MARK : formatNumber(entry.grade, locale)}
                      </td>
                    </tr>
                  ))
                : students.map((student) => {
                    const row = rowOf(student.studentId)
                    return (
                      <tr key={student.studentId} className="border-t border-line">
                        <td className="py-2 pr-3 font-semibold text-ink">{student.fullName}</td>
                        <td className="py-2 text-center">
                          <span className="inline-flex items-center gap-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              maxLength={5}
                              value={row.da ? DA_MARK : row.grade}
                              disabled={row.da}
                              placeholder={t('class_list.placeholder_grade')}
                              aria-label={`${t('grade_report.col_exam')} — ${student.fullName}`}
                              onChange={(event) => update(student.studentId, { grade: event.target.value })}
                              className={cellClass(invalid(row))}
                            />
                            <button
                              type="button"
                              aria-pressed={row.da}
                              onClick={() => update(student.studentId, { da: !row.da })}
                              className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                                row.da
                                  ? 'border-red-200 bg-red-50 text-red-700'
                                  : 'border-line text-muted-foreground hover:text-ink'
                              }`}
                            >
                              {t('class_list.did_not_sit_short')}
                            </button>
                          </span>
                        </td>
                      </tr>
                    )
                  })}
            </tbody>
          </table>
        </div>

        <div className="px-4">
          {anyInvalid && !reviewing ? (
            <p className="text-xs font-semibold text-red-600">{t('class_list.batch_invalid')}</p>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-amber-700">
              <BoIcon name="alert" size={13} className="shrink-0" />
              {t('class_list.final_warning')}
            </p>
          )}
        </div>

        <DialogFooter className="grid grid-cols-2 gap-2">
          {reviewing ? (
            <>
              <button
                type="button"
                onClick={() => setReviewing(false)}
                className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
              >
                {t('class_list.back_to_edit')}
              </button>
              <button
                type="button"
                onClick={confirm}
                className="rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep"
              >
                {t('class_list.batch_confirm', { count: entries.length })}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={close}
                className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
              >
                {t('class_list.cancel')}
              </button>
              <button
                type="button"
                onClick={() => setReviewing(true)}
                disabled={entries.length === 0 || anyInvalid}
                className="rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-default disabled:opacity-50"
              >
                {t('class_list.batch_review', { count: entries.length })}
              </button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
