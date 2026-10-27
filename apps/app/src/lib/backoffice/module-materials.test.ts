import { describe, expect, it } from 'vitest'
import { moduleMaterialIssues, resizeModuleMaterials, sameModuleMaterials } from './module-materials'

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
