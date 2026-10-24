import { CSV_BOM, csvLine, ndjsonToCsv } from './csv'
import type { NationalIdType, StudentRow, StudentStatus } from './types'
import { countryName } from '@/lib/geo'
import { formatSpreadsheetDateTime } from '@/lib/format'

/**
 * The student directory as a CSV (OOC-121). `apps/api` picks the students —
 * the same tab, search and age filter the screen shows, every page — and
 * sends one directory row per line (NDJSON, the `StudentRow` of `GET
 * /students`); this module writes them as CSV in the reader's language.
 * Column titles and enum words come from the locale (CLAUDE.md §4); every
 * cell goes through `csvCell`, because names, documents and contact are typed
 * on the public checkout (CLAUDE.md §8, CSV injection).
 *
 * Document, e-mail and phone are in the file: only the cargos that already
 * read them in the ficha may export (`canExportStudents`).
 */
/** The file's columns, in order — each title is `bo.student_export.col_<key>`. */
export const STUDENT_EXPORT_COLUMNS = [
  'first_name',
  'last_name',
  'id_type',
  'id_number',
  'email',
  'phone',
  'birth_date',
  'minor',
  'country',
  'region',
  'city',
  'status',
  'active_courses',
  'total_enrollments',
  'created_at',
  'last_activity',
] as const

export type StudentExportColumn = (typeof STUDENT_EXPORT_COLUMNS)[number]

export interface StudentExportLabels {
  column: (key: StudentExportColumn) => string
  nationalIdType: (type: NationalIdType) => string
  status: (status: StudentStatus) => string
  yes: string
  no: string
  /** For the country name, as `Intl.DisplayNames` reads it. */
  locale: string
}

export function studentExportHeader(labels: StudentExportLabels): string {
  return `${CSV_BOM}${csvLine(STUDENT_EXPORT_COLUMNS.map(labels.column))}`
}

export function studentExportLine(row: StudentRow, labels: StudentExportLabels): string {
  const cells: Record<StudentExportColumn, string | number | null> = {
    first_name: row.firstName,
    last_name: row.lastName,
    id_type: labels.nationalIdType(row.nationalIdType),
    id_number: row.nationalId,
    email: row.email,
    phone: row.phone,
    birth_date: row.birthDate,
    minor: row.isMinor ? labels.yes : labels.no,
    country: countryName(row.country, labels.locale),
    region: row.region,
    city: row.city,
    status: labels.status(row.status),
    active_courses: row.activeCourses,
    total_enrollments: row.totalEnrollments,
    created_at: formatSpreadsheetDateTime(row.createdAt),
    last_activity: formatSpreadsheetDateTime(row.lastActivityAt),
  }
  return csvLine(STUDENT_EXPORT_COLUMNS.map((key) => cells[key]))
}

/** The API's NDJSON as the CSV the reader downloads. */
export function ndjsonToStudentCsv(
  source: ReadableStream<Uint8Array>,
  labels: StudentExportLabels,
): ReadableStream<Uint8Array> {
  return ndjsonToCsv<StudentRow>(source, studentExportHeader(labels), (row) => studentExportLine(row, labels))
}
