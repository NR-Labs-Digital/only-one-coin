// Client-safe on purpose: the roster (a client component) builds its URLs with
// these, so nothing here may import the server-only `api-client`.

/**
 * What the reader narrowed the teacher roster to (OOC-78). Lives in the URL
 * (`/backoffice/teachers?status=inactive&language=Italiano`), so a filtered
 * view survives a reload and can be sent to a colleague as a link.
 */
export interface TeacherDirectoryQuery {
  page: number
  q: string
  /** The tab: who can be given a class group tomorrow, or who used to be. */
  status: 'active' | 'inactive'
  /** Catalog language text, or null for every language. */
  language: string | null
  /** Only teachers running nothing right now — roster tab only. */
  free: boolean
  /** Only contracts lapsing, lapsed or never filed — roster tab only. */
  contract: boolean
}

/** Mirrors the API's floor on `q` — shorter than this is no search at all. */
export const MIN_SEARCH_LENGTH = 2

/** The API's ceiling on `q` and `language`. */
const MAX_TEXT_LENGTH = 100

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Reads the roster query out of the page's search params. Anything the API
 * would refuse is dropped here rather than sent: a hand-edited URL lands on the
 * unfiltered roster, not on the "could not load" screen.
 */
export function parseTeacherDirectoryQuery(
  params: Record<string, string | string[] | undefined>,
): TeacherDirectoryQuery {
  const page = Number.parseInt(first(params.page) ?? '', 10)
  const q = first(params.q)?.trim() ?? ''
  const language = first(params.language)?.trim() ?? ''
  const status = first(params.status) === 'inactive' ? 'inactive' : 'active'
  const onRoster = status === 'active'

  return {
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    q: q.length >= MIN_SEARCH_LENGTH && q.length <= MAX_TEXT_LENGTH ? q : '',
    status,
    language: language.length > 0 && language.length <= MAX_TEXT_LENGTH ? language : null,
    // Questions about somebody still teaching — meaningless off the roster.
    free: onRoster && first(params.free) === 'true',
    contract: onRoster && first(params.contract) === 'true',
  }
}

/** The same query as URL search params, leaving out whatever is the default. */
export function teacherDirectorySearchParams(query: TeacherDirectoryQuery): URLSearchParams {
  const search = new URLSearchParams()
  if (query.page > 1) search.set('page', String(query.page))
  if (query.q) search.set('q', query.q)
  if (query.status === 'inactive') search.set('status', 'inactive')
  if (query.language) search.set('language', query.language)
  if (query.status === 'active' && query.free) search.set('free', 'true')
  if (query.status === 'active' && query.contract) search.set('contract', 'true')
  return search
}
