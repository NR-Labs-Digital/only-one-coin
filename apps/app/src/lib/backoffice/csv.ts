/**
 * The CSV every backoffice export writes — the grade report, the student
 * directory (OOC-121) and whatever comes next. One place for the one rule
 * that is not optional (CLAUDE.md §8): text a spreadsheet would run as a
 * formula goes out as text.
 */

/**
 * One CSV field. Text that opens with `=`, `+`, `-`, `@`, tab or CR is read by
 * Excel as a formula, and a student's name is typed by the student on the
 * public checkout — so such text goes out with a leading `'`, which the
 * spreadsheet shows as plain text (CSV injection). Numbers are written as
 * numbers.
 */
export function csvCell(value: string | number | null): string {
  if (value === null) return ''
  const raw = String(value)
  const text = typeof value === 'string' && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** One record, CRLF-terminated as RFC 4180 and Excel expect. */
export function csvLine(values: (string | number | null)[]): string {
  return `${values.map(csvCell).join(',')}\r\n`
}

/** Byte order mark: without it Excel reads the accents in the names as mojibake. */
export const CSV_BOM = '﻿'

/** Hands a file to the browser — no request, nothing uploaded. */
export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

/** Hands CSV text to the browser as a file. */
export function downloadCsv(fileName: string, csv: string): void {
  downloadBlob(fileName, new Blob([csv], { type: 'text/csv;charset=utf-8' }))
}

/**
 * NDJSON in, CSV out, as it streams — what an export route handler hands the
 * browser: `apps/api` picks the rows, this writes them in the reader's
 * language, and the file is never held whole in the function. `header` is the
 * first bytes (BOM and titles); a line split across two chunks waits in
 * `pending` for its end.
 */
export function ndjsonToCsv<T>(
  source: ReadableStream<Uint8Array>,
  header: string,
  line: (row: T) => string,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let pending = ''
  const toCsv = (lines: string[]) =>
    lines
      .filter((text) => text.trim() !== '')
      .map((text) => line(JSON.parse(text) as T))
      .join('')

  return source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(header))
      },
      transform(chunk, controller) {
        const lines = (pending + decoder.decode(chunk, { stream: true })).split('\n')
        pending = lines.pop() ?? ''
        const csv = toCsv(lines)
        if (csv) controller.enqueue(encoder.encode(csv))
      },
      flush(controller) {
        const csv = toCsv([pending + decoder.decode()])
        if (csv) controller.enqueue(encoder.encode(csv))
      },
    }),
  )
}
