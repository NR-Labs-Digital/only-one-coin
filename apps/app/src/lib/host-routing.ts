import { BACKOFFICE_HOST, STUDENT_HOST, TEACHER_HOST } from './hosts'

/**
 * What the middleware does with a request, decided from its host and path
 * alone (apps/app/CLAUDE.md, "Três domínios, um deploy"). Pure and edge-safe
 * so it can be tested without a request object.
 *
 * - `rewrite`: serve another internal path; the browser keeps its URL.
 * - `redirect`: send the browser to another URL (another host, or the same
 *   host on another path).
 * - `pass`: leave the path alone.
 */
export type HostRoute =
  | { kind: 'pass' }
  | { kind: 'rewrite'; pathname: string }
  | { kind: 'redirect'; url: string }

/**
 * The two staff account screens that live under `/backoffice` but serve every
 * staff door: an invite or a password reset of a `teacher` account is opened
 * on the teacher domain, so its session cookie is set there.
 */
const SHARED_STAFF_SEGMENTS = new Set(['invite', 'reset-password'])

type SplitPath = { locale: string | null; segments: string[] }

function split(pathname: string, locales: readonly string[]): SplitPath {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length > 0 && locales.includes(segments[0])) {
    return { locale: segments[0], segments: segments.slice(1) }
  }
  return { locale: null, segments }
}

function join({ locale, segments }: SplitPath): string {
  const parts = locale ? [locale, ...segments] : segments
  return `/${parts.join('/')}`
}

function withPrefix(path: SplitPath, prefix: string): string {
  return join({ locale: path.locale, segments: [prefix, ...path.segments] })
}

export function routeForHost(
  host: string | null,
  pathname: string,
  search: string,
  locales: readonly string[],
): HostRoute {
  const path = split(pathname, locales)
  const first = path.segments[0]
  const onTeacherHost = `https://${TEACHER_HOST}${pathname}${search}`

  if (host === TEACHER_HOST) {
    if (first === 'docente') return { kind: 'pass' }
    if (first === 'backoffice') {
      if (SHARED_STAFF_SEGMENTS.has(path.segments[1])) return { kind: 'pass' }
      // Everything else under /backoffice is the panel, whose own domain is
      // where its session lives.
      return { kind: 'redirect', url: `https://${BACKOFFICE_HOST}${pathname}${search}` }
    }
    return { kind: 'rewrite', pathname: withPrefix(path, 'docente') }
  }

  // The teacher portal has one public address. Before this domain it was
  // reached at student.*/docente, and backoffice.*/docente was a 404 (the
  // backoffice rewrite turned it into /backoffice/docente).
  if ((host === STUDENT_HOST || host === BACKOFFICE_HOST) && first === 'docente') {
    return { kind: 'redirect', url: onTeacherHost }
  }

  if (host === BACKOFFICE_HOST && first !== 'backoffice') {
    return { kind: 'rewrite', pathname: withPrefix(path, 'backoffice') }
  }

  return { kind: 'pass' }
}
