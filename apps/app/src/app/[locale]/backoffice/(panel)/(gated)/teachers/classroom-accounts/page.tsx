import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getStaffSession } from '@/lib/backoffice/session'
import { canManageClassroomAccounts, canViewClassroomAccounts } from '@/lib/backoffice/permissions'
import { listClassroomAccounts } from '@/lib/backoffice/classroom-accounts'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { ClassroomAccountsView } from './classroom-accounts-view'

/**
 * The shared Google Classroom logins (OOC-196). The institution lends one
 * Google account to several teachers at a time, up to the cap set in
 * Configuración; this screen registers them, shows who uses each, changes the
 * e-mail or the password, and flags the accounts a teacher left since the last
 * password change. Hiding the actions is a convenience — the permission on
 * each route in `apps/api` is the check (CLAUDE.md §8).
 */
export default async function ClassroomAccountsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')
  const staff = await getStaffSession()

  const back = (
    <Link
      href="/backoffice/teachers"
      className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-ink"
    >
      <BoIcon name="arrow-left" size={16} />
      {t('classroom_accounts.back')}
    </Link>
  )

  if (!canViewClassroomAccounts(staff)) {
    return (
      <div className="flex flex-col gap-5">
        {back}
        <PageHeader title={t('classroom_accounts.title')} />
        <EmptyState icon="shield" title={t('classroom_accounts.locked_title')} body={t('classroom_accounts.locked_body')} />
      </div>
    )
  }

  const list = await listClassroomAccounts()

  return (
    <div className="flex flex-col gap-5">
      {back}
      <PageHeader title={t('classroom_accounts.title')} />
      {list ? (
        <ClassroomAccountsView list={list} canManage={canManageClassroomAccounts(staff)} />
      ) : (
        <EmptyState
          icon="alert"
          title={t('classroom_accounts.load_error_title')}
          body={t('classroom_accounts.load_error_body')}
        />
      )}
    </div>
  )
}
