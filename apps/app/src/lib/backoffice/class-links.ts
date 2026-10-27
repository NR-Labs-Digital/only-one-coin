/**
 * The external links a class group carries — Google Meet for the class,
 * Classroom for the coursework (`docs/REGRAS-NEGOCIO.md` §8), Drive or Docs
 * for the module's material (OOC-94). Set by
 * coordination, never generated: the platform does not integrate with either
 * (CLAUDE.md §2).
 *
 * A pasted link ends up as an `href` on a teacher's screen, so it is checked
 * against the host it claims to be — `https:` and the Google host, nothing
 * else. A `javascript:` or look-alike URL is refused here instead of rendered.
 */
export type ClassLinkKind = 'meet' | 'classroom' | 'drive'

/** `drive` mirrors `MODULE_MATERIAL_HOSTS` in `@ooc/domain` — the API refuses what this lets through. */
const HOSTS: Record<ClassLinkKind, readonly string[]> = {
  meet: ['meet.google.com'],
  classroom: ['classroom.google.com'],
  drive: ['drive.google.com', 'docs.google.com'],
}

/**
 * The link, normalised, or null when it is not a link of that kind. An empty
 * field is not an error — the group opens before the Meet exists — so the
 * caller tells "left blank" (`''`) from "typed wrong" (`null`).
 */
export function parseClassLink(raw: string, kind: ClassLinkKind): string | null {
  const value = raw.trim()
  if (value === '') return ''
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || !HOSTS[kind].includes(url.hostname)) return null
  return url.toString()
}

/**
 * What the class group form sends for its Classroom field (OOC-98): the link
 * normalized, `null` when the field is empty — which clears a link already
 * set — or `'invalid'` while what is typed is not a Classroom link. The API
 * checks the same host again (`normalizeClassroomUrl` in `@ooc/domain`).
 */
export function classroomUrlOf(raw: string): string | null | 'invalid' {
  const parsed = parseClassLink(raw, 'classroom')
  if (parsed === null) return 'invalid'
  return parsed === '' ? null : parsed
}
