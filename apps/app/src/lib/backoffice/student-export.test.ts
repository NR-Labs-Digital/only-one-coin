import { describe, expect, it } from 'vitest'
import { ndjsonToStudentCsv, type StudentExportLabels } from './student-export'
import type { StudentRow } from './types'

const LABELS: StudentExportLabels = {
  column: (key) => `[${key}]`,
  nationalIdType: (type) => `type:${type}`,
  status: (status) => `status:${status}`,
  yes: 'Y',
  no: 'N',
  locale: 'es',
}

const ROW: StudentRow = {
  id: '018f2b5c-0000-7000-8000-000000000001',
  firstName: 'Rosa',
  lastName: 'Quispe, Mamani',
  nationalIdType: 'DNI',
  nationalId: '70123456',
  email: 'rosa.quispe@gmail.com',
  phone: '987654321',
  birthDate: '1996-04-12',
  isMinor: false,
  status: 'active',
  country: 'PE',
  region: null,
  city: 'Chorrillos',
  activeCourses: 1,
  totalEnrollments: 2,
  createdAt: '2026-09-01T03:30:00.000Z',
  lastActivityAt: '2026-09-02T15:05:00.000Z',
}

/** The NDJSON split into byte chunks at the given offsets, as a network delivers it. */
function streamOf(text: string, cuts: number[]): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  const edges = [0, ...cuts, bytes.length]
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < edges.length - 1; i++) controller.enqueue(bytes.slice(edges[i], edges[i + 1]))
      controller.close()
    },
  })
}

async function csvOf(text: string, cuts: number[] = []): Promise<string[]> {
  const bytes = await new Response(ndjsonToStudentCsv(streamOf(text, cuts), LABELS)).arrayBuffer()
  // `ignoreBOM` keeps the mark Excel needs, which a plain decode drops.
  const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
  return csv.split('\r\n')
}

describe('student directory CSV', () => {
  it('writes the titles from the locale, then one line per row', async () => {
    const [header, line, end] = await csvOf(`${JSON.stringify(ROW)}\n`)

    expect(header).toBe(
      '﻿[first_name],[last_name],[id_type],[id_number],[email],[phone],[birth_date],[minor],[country],[region],[city],[status],[active_courses],[total_enrollments],[created_at],[last_activity]',
    )
    expect(line).toBe(
      'Rosa,"Quispe, Mamani",type:DNI,70123456,rosa.quispe@gmail.com,987654321,1996-04-12,N,Perú,,Chorrillos,status:active,1,2,2026-08-31 22:30,2026-09-02 10:05',
    )
    expect(end).toBe('')
  })

  it('reassembles a row split across chunks, accents included', async () => {
    const text = [ROW, { ...ROW, firstName: 'Ñandú José' }].map((row) => JSON.stringify(row)).join('\n')
    const accent = new TextEncoder().encode(text).indexOf(0xc3)
    const lines = await csvOf(text, [7, accent + 1, accent + 30])

    expect(lines).toHaveLength(4)
    expect(lines[2]?.startsWith('Ñandú José,')).toBe(true)
  })

  it('writes text that would run as a formula as text', async () => {
    const [, line] = await csvOf(JSON.stringify({ ...ROW, firstName: '=HYPERLINK("x")', phone: '+51987654321' }))

    expect(line?.startsWith(`"'=HYPERLINK(""x"")",`)).toBe(true)
    expect(line).toContain(",'+51987654321,")
  })

  it('an empty export is the titles alone', async () => {
    const lines = await csvOf('')
    expect(lines).toHaveLength(2)
  })
})
