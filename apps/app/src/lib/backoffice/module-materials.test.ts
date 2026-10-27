import { describe, expect, it } from 'vitest'
import {
  moduleMaterialIssues,
  moduleMaterialsChanged,
  moduleMaterialsReady,
  resizeModuleMaterials,
  sameModuleMaterials,
  setModuleMaterial,
} from './module-materials'

const LINK = 'https://drive.google.com/x'

describe('moduleMaterialsChanged', () => {
  const legacy = { modules: 4, moduleMaterials: [] as string[] }

  it('a legacy course whose link was typed and cleared has not changed', () => {
    expect(moduleMaterialsChanged({ modules: 4, moduleMaterials: ['', '', '', ''] }, legacy)).toBe(false)
  })

  it('a module count changed and changed back has not changed', () => {
    const course = { modules: 4, moduleMaterials: [LINK, LINK, LINK, LINK] }
    expect(moduleMaterialsChanged({ modules: 4, moduleMaterials: [LINK, LINK, LINK, LINK] }, course)).toBe(false)
  })

  it('a new count or a new link is a change', () => {
    expect(moduleMaterialsChanged({ modules: 3, moduleMaterials: [] }, legacy)).toBe(true)
    expect(moduleMaterialsChanged({ modules: 4, moduleMaterials: [LINK] }, legacy)).toBe(true)
  })
})

describe('moduleMaterialsReady', () => {
  it('needs a valid link in every module', () => {
    expect(moduleMaterialsReady({ modules: 2, moduleMaterials: [LINK, LINK] })).toBe(true)
    expect(moduleMaterialsReady({ modules: 2, moduleMaterials: [LINK, ''] })).toBe(false)
  })

  it('reads only the links of the modules the count keeps', () => {
    expect(moduleMaterialsReady({ modules: 1, moduleMaterials: [LINK, 'not a link'] })).toBe(true)
  })

  it('is never ready without a whole, positive module count', () => {
    expect(moduleMaterialsReady({ modules: 0, moduleMaterials: [] })).toBe(false)
    expect(moduleMaterialsReady({ modules: 1.5, moduleMaterials: [LINK, LINK] })).toBe(false)
  })
})

describe('setModuleMaterial', () => {
  it('keeps the links past the module count, so a count typed key by key loses nothing', () => {
    expect(setModuleMaterial([LINK, 'b', 'c'], 1, 0, 'a')).toEqual(['a', 'b', 'c'])
  })

  it('pads up to the field being written', () => {
    expect(setModuleMaterial([], 4, 2, 'c')).toEqual(['', '', 'c', ''])
  })
})

describe('resizeModuleMaterials', () => {
  it('adds blank fields at the end', () => {
    expect(resizeModuleMaterials(['a', 'b'], 4)).toEqual(['a', 'b', '', ''])
  })

  it('cuts the last ones', () => {
    expect(resizeModuleMaterials(['a', 'b', 'c'], 2)).toEqual(['a', 'b'])
  })

  it('never goes below zero, whatever the module field holds', () => {
    expect(resizeModuleMaterials(['a'], 0)).toEqual([])
    expect(resizeModuleMaterials(['a'], -3)).toEqual([])
    expect(resizeModuleMaterials(['a'], Number.NaN)).toEqual([])
  })
})

describe('sameModuleMaterials', () => {
  it('compares by content and order', () => {
    expect(sameModuleMaterials(['a'], ['a'])).toBe(true)
    expect(sameModuleMaterials(['a'], ['a', ''])).toBe(false)
    expect(sameModuleMaterials(['a', 'b'], ['b', 'a'])).toBe(false)
  })
})

describe('moduleMaterialIssues', () => {
  it('names what is wrong with each field', () => {
    expect(
      moduleMaterialIssues(['', 'https://evil.com/x', 'https://drive.google.com/x']),
    ).toEqual(['missing', 'invalid', null])
  })
})
