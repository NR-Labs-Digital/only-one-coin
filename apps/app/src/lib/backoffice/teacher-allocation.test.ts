import { describe, expect, it } from 'vitest'
import { teachersForLanguage } from './teacher-allocation'
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
