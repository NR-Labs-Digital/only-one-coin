/**
 * The external links a class group carries — its Google Classroom, where the
 * Meet lives (`docs/REGRAS-NEGOCIO.md` §8, OOC-98), and Drive or Docs for the
 * module's material (OOC-94). Set by coordination, never generated: the
 * platform does not integrate with either (CLAUDE.md §2).
 *
 * A pasted link ends up as an `href` on a teacher's or a student's screen, so
 * it is checked against the host it claims to be — `https:` and the Google
 * host, nothing else. A `javascript:` or look-alike URL is refused here
 * instead of rendered.
 */
export type ClassLinkKind = 'classroom' | 'drive' | 'meet'

/**
 * `classroom` mirrors `CLASSROOM_HOST`, `drive` `MODULE_MATERIAL_HOSTS` and
 * `meet` `MEET_HOST` in `@ooc/domain` — the API refuses what this lets through.
 */
const HOSTS: Record<ClassLinkKind, readonly string[]> = {
  classroom: ['classroom.google.com'],
  drive: ['drive.google.com', 'docs.google.com'],
  meet: ['meet.google.com'],
}

/**
 * The link, normalised, or null when it is not a link of that kind. An empty
 * field is not an error — the group opens before the Classroom exists — so the
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
 * One Classroom quick link (OOC-144): one per module the class group teaches.
 * `module` is null only for the single link pasted before OOC-144 on a class
 * group with no module set.
 */
export interface ClassroomLink {
  module: number | null
  url: string
}

/**
 * The links that pass the host check, normalized — what may become an `href`.
 * A link that is not the Google host it claims to be is dropped, never drawn.
 */
export function safeClassroomLinks(links: readonly ClassroomLink[]): ClassroomLink[] {
  return links.flatMap((link) => {
    const url = parseClassLink(link.url, 'classroom')
    return url ? [{ module: link.module, url }] : []
  })
}

/**
 * What the class group form sends for a Classroom field (OOC-98, one per module since OOC-144): the link
 * normalized, `null` when the field is empty — which clears a link already
 * set — or `'invalid'` while what is typed is not a Classroom link. The API
 * checks the same host again (`normalizeClassroomUrl` in `@ooc/domain`).
 */
export function classroomUrlOf(raw: string): string | null | 'invalid' {
  const parsed = parseClassLink(raw, 'classroom')
  if (parsed === null) return 'invalid'
  return parsed === '' ? null : parsed
}

/**
 * The same for a module group's Google Meet (OOC-159): normalized, `null` for
 * an empty field (clears it), `'invalid'` while it is not a Meet link. The API
 * checks again (`normalizeMeetUrl` in `@ooc/domain`).
 */
export function meetUrlOf(raw: string): string | null | 'invalid' {
  const parsed = parseClassLink(raw, 'meet')
  if (parsed === null) return 'invalid'
  return parsed === '' ? null : parsed
}

/** A stored Meet link that passes the host check, or null — never an unchecked `href`. */
export function safeMeetUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  return parseClassLink(raw, 'meet') || null
}
