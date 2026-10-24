import { hasLocale } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import type { NextRequest } from 'next/server'
import { routing } from '@/i18n/routing'
import { apiFetch } from '@/lib/backoffice/api-client'
import { ndjsonToAuditCsv } from '@/lib/backoffice/audit-export'
import { auditActionLabel, auditRoleLabel } from '@/lib/backoffice/audit-labels'
import { auditLogSearchParams, parseAuditLogQuery } from '@/lib/backoffice/audit-log-query'
import { isFeatureEnabled } from '@/lib/feature-flags/server'

/**
 * The general audit log as a CSV (OOC-122), for the screen's "Export".
 *
 * `apps/api` decides who may export, which entries (the screen's filters,
 * every page), records the export in the log itself and rate-limits it; this
 * handler only writes the rows in the reader's language, as they stream —
 * same split as the student export (OOC-121). A refusal keeps the API's
 * status and no body: the button reads 403 and 429 and says so.
 */
export async function GET(request: NextRequest): Promise<Response> {
  /* The section's own gate: a route handler sits under no layout. */
  if (!(await isFeatureEnabled('backoffice.audit'))) {
    return new Response(null, { status: 404 })
  }

  const requested = request.nextUrl.searchParams.get('locale')
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale
  const search = auditLogSearchParams(parseAuditLogQuery(Object.fromEntries(request.nextUrl.searchParams)))

  let upstream: Response
  try {
    upstream = await apiFetch(`/api/v1/audit-log/export?${search}`)
  } catch {
    return new Response(null, { status: 502 })
  }
  if (!upstream.ok || !upstream.body) {
    return new Response(null, { status: upstream.ok ? 502 : upstream.status })
  }

  const t = await getTranslations({ locale, namespace: 'bo' })
  const csv = ndjsonToAuditCsv(upstream.body, {
    column: (key) => t(`audit_log.col_${key}`),
    action: (key) => auditActionLabel(t, key),
    entity: (key) => t(`audit_log.entity.${key}`),
    field: (key) => t(`audit_log.field.${key}`),
    role: (role) => auditRoleLabel(t, role) ?? '',
    unknownActor: t('audit_log.actor_unknown'),
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
