import { parseClassLink } from './class-links'

/**
 * One material link per module (OOC-94), as the course form edits them. The
 * API holds the rule (`Course` in `@ooc/domain`); these only let the screen
 * say what is wrong beside the field before anything is sent.
 */

/** The list as long as the module count says: kept by position, padded blank. */
export function resizeModuleMaterials(list: readonly string[], count: number): string[] {
  const length = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0
  return Array.from({ length }, (_, index) => list[index] ?? '')
}

export function sameModuleMaterials(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

export type ModuleMaterialIssue = 'missing' | 'invalid'

/** What is wrong with each field, by position — null when the link is good. */
export function moduleMaterialIssues(list: readonly string[]): (ModuleMaterialIssue | null)[] {
  return list.map((raw) => {
    const parsed = parseClassLink(raw, 'drive')
    if (parsed === '') return 'missing'
    if (parsed === null) return 'invalid'
    return null
  })
}
