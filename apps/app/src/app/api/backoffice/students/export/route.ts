import { hasLocale } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import type { NextRequest } from 'next/server'
import { routing } from '@/i18n/routing'
import { apiFetch } from '@/lib/backoffice/api-client'
import {
  parseStudentDirectoryQuery,
  studentDirectorySearchParams,
} from '@/lib/backoffice/student-directory-query'
import { ndjsonToStudentCsv } from '@/lib/backoffice/student-export'
import { isFeatureEnabled } from '@/lib/feature-flags/server'

/**
 * The student directory as a CSV (OOC-121), for the "Export" button.
 *
 * `apps/api` decides everything that matters — who may export, which students
 * (the tab, search and age filter the screen shows, every page), the audit
 * entry and the rate limit — and answers one row per line. This handler only
 * writes those rows in the reader's language: column titles are UI text and
 * live in the locale files (CLAUDE.md §4), which the API does not have. The
 * file streams through as it is written; 30k students are never one string
 * here.
 *
 * A refusal keeps the API's status and no body: the button reads 403 and 429
 * and says so in the reader's language.
 */
export async function GET(request: NextRequest): Promise<Response> {
  /* The section's own gate: a route handler sits under no layout. */
  if (!(await isFeatureEnabled('backoffice.students'))) {
    return new Response(null, { status: 404 })
  }

  const requested = request.nextUrl.searchParams.get('locale')
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale
  const query = parseStudentDirectoryQuery(Object.fromEntries(request.nextUrl.searchParams))
  const search = studentDirectorySearchParams({ ...query, page: 1 })

  let upstream: Response
  try {
    upstream = await apiFetch(`/api/v1/students/export?${search}`)
  } catch {
    return new Response(null, { status: 502 })
  }
  if (!upstream.ok || !upstream.body) {
    return new Response(null, { status: upstream.ok ? 502 : upstream.status })
  }

  const t = await getTranslations({ locale, namespace: 'bo' })
  const csv = ndjsonToStudentCsv(upstream.body, {
    column: (key) => t(`student_export.col_${key}`),
    nationalIdType: (type) => t(`national_id_type.${type}`),
    status: (status) => t(`student_status.${status}`),
    yes: t('student_export.yes'),
    no: t('student_export.no'),
    locale,
  })

  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'cache-control': 'no-store',
      'x-row-count': upstream.headers.get('x-row-count') ?? '',
    },
  })
}
