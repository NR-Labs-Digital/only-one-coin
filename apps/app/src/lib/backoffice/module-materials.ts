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

interface ModuleShape {
  modules: number
  moduleMaterials: readonly string[]
}

/**
 * The form's draft keeps every link typed, even past the module count: the
 * count is typed key by key ("12" passes through "1", a backspace through
 * nothing), and cutting the list on each keystroke would drop links already
 * there. The count is applied when the list is shown, checked or sent.
 */
export function setModuleMaterial(list: readonly string[], modules: number, index: number, link: string): string[] {
  const next = resizeModuleMaterials(list, Math.max(list.length, modules, index + 1))
  next[index] = link
  return next
}

/**
 * The modules as the screen shows them differ from the course's — compared
 * the way they render, so a link typed and cleared on a course that had none,
 * or a count changed and changed back, is no change.
 */
export function moduleMaterialsChanged(draft: ModuleShape, course: ModuleShape): boolean {
  return (
    draft.modules !== course.modules ||
    !sameModuleMaterials(
      resizeModuleMaterials(draft.moduleMaterials, draft.modules),
      resizeModuleMaterials(course.moduleMaterials, course.modules),
    )
  )
}

/** A whole, positive module count with a valid link in each module. */
export function moduleMaterialsReady({ modules, moduleMaterials }: ModuleShape): boolean {
  return (
    Number.isInteger(modules) &&
    modules >= 1 &&
    moduleMaterialIssues(resizeModuleMaterials(moduleMaterials, modules)).every((issue) => issue === null)
  )
}

/** The list the API gets: one normalized link per module the count keeps. */
export function moduleMaterialsPayload({ modules, moduleMaterials }: ModuleShape): string[] {
  return resizeModuleMaterials(moduleMaterials, modules).map((link) => parseClassLink(link, 'drive') ?? link)
}
