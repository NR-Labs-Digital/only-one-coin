import type { ClassGroupStudent } from './types'

/**
 * The grade report of a finished class group, as a CSV the teacher downloads.
 *
 * Names and grades only. A teacher sees who is in the class, never the
 * student's document, contact or money — so nothing of that goes in the file
 * either, even if the roster row happened to carry it. The column titles and
 * the status words come from the locale (CLAUDE.md §4); this module only
 * arranges them.
 */
export interface GradeReportLabels {
  student: string
  /** The final exam's grade — the module's one grade. */
  grade: string
  status: string
  statusOf: (status: ClassGroupStudent['gradeStatus']) => string
}

/**
 * One CSV field. Text that opens with `=`, `+`, `-`, `@`, tab or CR is read by
 * Excel as a formula, and the student's name is typed by the student on the
 * public checkout — so such text goes out with a leading `'`, which the
 * spreadsheet shows as plain text (CSV injection). Numbers are written as
 * numbers: a grade is never negative.
 */
function cell(value: string | number | null): string {
  if (value === null) return ''
  const raw = String(value)
  const text = typeof value === 'string' && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function gradeReportCsv(
  roster: ClassGroupStudent[],
  labels: GradeReportLabels,
): string {
  const rows = [...roster]
    /* Somebody moved out by a procedure left the class, not a grade behind. */
    .filter((student) => student.procedure === null)
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
    .map((student) =>
      [
        cell(student.fullName),
        cell(student.gradeStatus === 'auto_failed' ? 'DA' : student.finalGrade),
        cell(labels.statusOf(student.gradeStatus)),
      ].join(','),
    )
  const header = [labels.student, labels.grade, labels.status]
    .map(cell)
    .join(',')
  /* BOM first: without it Excel reads the accents in the names as mojibake. */
  return `﻿${[header, ...rows].join('\r\n')}\r\n`
}

/** Hands the text to the browser as a file — no request, nothing uploaded. */
export function downloadCsv(fileName: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}
