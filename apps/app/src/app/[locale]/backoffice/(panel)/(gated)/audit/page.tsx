import { getTranslations, setRequestLocale } from 'next-intl/server'
import { getAuditActors, getAuditLog } from '@/lib/backoffice/audit-log'
import { auditLogSearchParams, parseAuditLogQuery } from '@/lib/backoffice/audit-log-query'
import { getStaffSession } from '@/lib/backoffice/session'
import {
  canBrowseCatalog,
  canEditStudent,
  canManageTeachers,
  canViewAuditLog,
  canViewPayments,
} from '@/lib/backoffice/permissions'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { AuditLogView } from './audit-log-view'

/**
 * The general audit log (OOC-122). The filters live in the URL and run in
 * Postgres: this server component reads them from `searchParams` and fetches
 * the first page; the view loads older entries and rewrites the URL.
 */
export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  /* Asked for alongside the session, not after it: a cargo that may not read
     the log gets its 403 from the API and the answer is dropped. */
  const query = parseAuditLogQuery(await searchParams)
  const pageRequest = getAuditLog(query)
  const actorsRequest = getAuditActors()
  const staff = await getStaffSession()

  if (!canViewAuditLog(staff.role)) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t('audit_log.title')} />
        <EmptyState icon="shield" title={t('audit_log.locked_title')} body={t('audit_log.locked_body')} />
      </div>
    )
  }

  const [page, actors] = await Promise.all([pageRequest, actorsRequest])

  /* "Nothing happened" and "could not load" are different facts. */
  if (!page) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t('audit_log.title')} />
        <EmptyState icon="alert" title={t('audit_log.load_error_title')} body={t('audit_log.load_error_body')} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('audit_log.title')} />
      <AuditLogView
        // A new filter is a new list: the older entries loaded for the last one go.
        key={auditLogSearchParams(query).toString()}
        page={page}
        query={query}
        actors={actors}
        links={{
          student: canEditStudent(staff.role),
          payment: canViewPayments(staff.role),
          classGroup: canBrowseCatalog(staff.role),
          teacher: canManageTeachers(staff.role),
        }}
      />
    </div>
  )
}
