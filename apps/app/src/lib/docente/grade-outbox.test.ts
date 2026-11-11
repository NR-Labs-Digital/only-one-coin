import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mergePendingGrades,
  postGrades,
  readGradeDraft,
  readPendingGrades,
  writeGradeDraft,
  writePendingGrades,
} from './grade-outbox'

/** OOC-38: what the grade sheet keeps on the device while the API has not answered. */

class MemoryStorage {
  private items = new Map<string, string>()
  getItem(key: string) {
    return this.items.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.items.set(key, value)
  }
  removeItem(key: string) {
    this.items.delete(key)
  }
}

beforeEach(() => {
  vi.stubGlobal('window', { localStorage: new MemoryStorage() })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('pending grades', () => {
  it('survive a reload, per class group', () => {
    writePendingGrades('g1', [{ enrollmentId: 'e1', grade: 13.5 }, { enrollmentId: 'e2', grade: 'da' }])

    expect(readPendingGrades('g1')).toEqual([
      { enrollmentId: 'e1', grade: 13.5 },
      { enrollmentId: 'e2', grade: 'da' },
    ])
    expect(readPendingGrades('g2')).toEqual([])
  })

  it('ignore what is not a pending grade', () => {
    window.localStorage.setItem('ooc:grades:pending:g1', JSON.stringify([{ enrollmentId: 'e1', grade: 'x' }, 3]))
    expect(readPendingGrades('g1')).toEqual([])
    window.localStorage.setItem('ooc:grades:pending:g1', '{not json')
    expect(readPendingGrades('g1')).toEqual([])
  })

  it('keep the first value of a seat already waiting', () => {
    expect(
      mergePendingGrades([{ enrollmentId: 'e1', grade: 12 }], [
        { enrollmentId: 'e1', grade: 18 },
        { enrollmentId: 'e2', grade: 15 },
      ]),
    ).toEqual([
      { enrollmentId: 'e1', grade: 12 },
      { enrollmentId: 'e2', grade: 15 },
    ])
  })

  it('work without storage at all', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('blocked')
        },
        setItem: () => {
          throw new Error('blocked')
        },
        removeItem: () => {
          throw new Error('blocked')
        },
      },
    })
    expect(() => writePendingGrades('g1', [{ enrollmentId: 'e1', grade: 12 }])).not.toThrow()
    expect(readPendingGrades('g1')).toEqual([])
  })
})

describe('the batch draft', () => {
  it('keeps only the cells that were filled', () => {
    writeGradeDraft('g1', { e1: { grade: '14', da: false }, e2: { grade: '', da: false }, e3: { grade: '', da: true } })
    expect(readGradeDraft('g1')).toEqual({ e1: { grade: '14', da: false }, e3: { grade: '', da: true } })
  })
})

describe('postGrades', () => {
  it.each([
    [200, 'posted'],
    [409, 'conflict'],
    [422, 'refused'],
    [404, 'refused'],
    [429, 'offline'],
    [503, 'offline'],
  ] as const)('reads %s as %s', async (status, expected) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })))
    await expect(postGrades('g1', [{ enrollmentId: 'e1', grade: 14 }])).resolves.toBe(expected)
  })

  it('reads a posting that finished the module as finished (OOC-102)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ recorded: 1, alreadyRecorded: 0, finished: true }), { status: 200 }),
      ),
    )
    await expect(postGrades('g1', [{ enrollmentId: 'e1', grade: 14 }])).resolves.toBe('finished')
  })

  it('reads a network failure as offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(postGrades('g1', [{ enrollmentId: 'e1', grade: 14 }])).resolves.toBe('offline')
  })
})
