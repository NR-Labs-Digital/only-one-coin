import { describe, expect, it } from 'vitest'
import { allocationWarnings, teachersForLanguage } from './teacher-allocation'
import type { TeacherOption } from './types'

function teacher(id: string, languages: string[]): TeacherOption {
  return { id, firstName: id, lastName: '', languages, availability: [], classGroups: [] }
}

describe('teachersForLanguage', () => {
  it('matches the language whatever its case, accents or spacing — like the API', () => {
    const options = [teacher('ana', ['Inglés']), teacher('luis', ['Italiano'])]
    expect(teachersForLanguage(options, ' INGLES ').map((item) => item.id)).toEqual(['ana'])
  })
})

describe('allocationWarnings (OOC-156)', () => {
  const TUE = [{ weekday: 'tue' as const, startTime: '19:00', endTime: '20:30' }]
  const ana: TeacherOption = {
    ...teacher('ana', ['Inglés']),
    classGroups: [
      { id: 'run-1', classGroupId: 'g-1', code: 'A-00001', module: 1, academicPeriodId: 'p', slots: TUE },
      { id: 'run-2', classGroupId: 'g-1', code: 'A-00001', module: 2, academicPeriodId: 'p', slots: TUE },
    ],
  }

  it('names each run that meets at the same time, with its module', () => {
    expect(allocationWarnings(ana, TUE, { academicPeriodId: 'p' }).clashes).toEqual([
      { code: 'A-00001', module: 1 },
      { code: 'A-00001', module: 2 },
    ])
  })

  it('never reports the run being edited, even beside another run of its class group', () => {
    expect(allocationWarnings(ana, TUE, { academicPeriodId: 'p', classGroupModuleId: 'run-1' }).clashes).toEqual([
      { code: 'A-00001', module: 2 },
    ])
  })
})
