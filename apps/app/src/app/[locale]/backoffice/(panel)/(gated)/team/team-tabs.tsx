import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { tabClass, tabStripClass } from '@/components/backoffice/tab-strip'

/**
 * The two sheets of Equipo: the people who open the panel, and the cargos —
 * what each can do, edited here since OOC-183. Each tab shows only to who may
 * open it (the analyst reads the cargos and not the people).
 */
export function TeamTabs({
  active,
  showPeople,
  showPermissions = true,
}: {
  active: 'people' | 'permissions'
  showPeople: boolean
  showPermissions?: boolean
}) {
  const t = useTranslations('bo')
  if (!showPeople || !showPermissions) return null

  return (
    <nav className={tabStripClass} aria-label={t('team.title')}>
      <Link
        href="/backoffice/team"
        className={tabClass(active === 'people')}
        aria-current={active === 'people' ? 'page' : undefined}
      >
        {t('team.tab_people')}
      </Link>
      <Link
        href="/backoffice/team/permissions"
        className={tabClass(active === 'permissions')}
        aria-current={active === 'permissions' ? 'page' : undefined}
      >
        {t('permissions.tab')}
      </Link>
    </nav>
  )
}
