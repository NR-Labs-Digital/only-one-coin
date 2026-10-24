import { CSV_BOM, csvLine } from './csv'
import type { GradeStatus } from './types'

/**
 * The grade report of a finished class group, as a CSV the teacher downloads.
 *
 * Names and grades only. A teacher sees who is in the class, never the
 * student's document, contact or money — so nothing of that goes in the file
 * either, even if the roster row happened to carry it. The column titles and
 * the status words come from the locale (CLAUDE.md §4); this module only
 * arranges them. A grade is never negative, so it goes out as a number.
 */
export interface GradeReportLabels {
  student: string
  /** The final exam's grade — the module's one grade. */
  grade: string
  status: string
  statusOf: (status: GradeStatus) => string
}

/** What the report reads of a student — and all it can write: the name and the grade. */
export interface GradeReportRow {
  fullName: string
  finalGrade: number | null
  gradeStatus: GradeStatus
}

export function gradeReportCsv(
  roster: GradeReportRow[],
  labels: GradeReportLabels,
): string {
  const rows = [...roster]
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
    .map((student) =>
      csvLine([
        student.fullName,
        student.gradeStatus === 'auto_failed' ? 'DA' : student.finalGrade,
        labels.statusOf(student.gradeStatus),
      ]),
    )
  return `${CSV_BOM}${csvLine([labels.student, labels.grade, labels.status])}${rows.join('')}`
}
