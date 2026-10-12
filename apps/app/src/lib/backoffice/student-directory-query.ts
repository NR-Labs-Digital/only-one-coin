// Client-safe on purpose: the directory table (a client component) builds its
// URLs with these, so nothing here may import the server-only `api-client`.

/**
 * What the reader narrowed the student directory to (OOC-76). Lives in the
 * URL (`/backoffice/students?status=active&minor=true&page=3`), so a filtered
 * view survives a reload and can be sent to a colleague as a link.
 */
export interface StudentDirectoryQuery {
  page: number
  q: string
  /** The tab (OOC-116). Opens on `active`: who studies now. */
  status: StudentDirectoryTab
  minor: boolean
}

export type StudentDirectoryTab = 'active' | 'former' | 'no_enrollment' | 'all'

/** Tab order on screen; the first is the default. */
export const STUDENT_DIRECTORY_TABS: readonly StudentDirectoryTab[] = [
  'active',
  'former',
  'no_enrollment',
  'all',
]

/** Mirrors the API's floor on `q` — shorter than this is no search at all. */
export const MIN_SEARCH_LENGTH = 2

/** The API's ceiling on `q`. */
const MAX_SEARCH_LENGTH = 100

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Reads the directory query out of the page's search params. Anything the API
 * would refuse is dropped here rather than sent: a hand-edited URL should land
 * on the unfiltered directory, not on the "could not load" screen.
 */
export function parseStudentDirectoryQuery(
  params: Record<string, string | string[] | undefined>,
): StudentDirectoryQuery {
  const page = Number.parseInt(first(params.page) ?? '', 10)
  const q = first(params.q)?.trim() ?? ''
  const status = first(params.status)

  return {
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    q: q.length >= MIN_SEARCH_LENGTH && q.length <= MAX_SEARCH_LENGTH ? q : '',
    status: STUDENT_DIRECTORY_TABS.find((tab) => tab === status) ?? 'active',
    minor: first(params.minor) === 'true',
  }
}

/** The same query as URL search params, leaving out whatever is the default. */
export function studentDirectorySearchParams(query: StudentDirectoryQuery): URLSearchParams {
  const search = new URLSearchParams()
  if (query.page > 1) search.set('page', String(query.page))
  if (query.q) search.set('q', query.q)
  if (query.status !== 'active') search.set('status', query.status)
  if (query.minor) search.set('minor', 'true')
  return search
}
