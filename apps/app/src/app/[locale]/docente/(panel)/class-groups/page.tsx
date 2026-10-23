import { getTranslations, setRequestLocale } from 'next-intl/server'
import { listOwnClassGroups } from '@/lib/docente/teaching'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { ClassGroupList } from './class-group-list'

/**
 * The teacher's class groups, from `GET /teaching/class-groups` — scoped by
 * the session in the API's usecase (CLAUDE.md §8), which also leaves out the
 * ones coordination closed (decision 08/10/2026). Nothing here filters: what
 * the API answers is what the teacher may open.
 */
export default async function TeacherClassGroupsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const groups = await listOwnClassGroups()

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('nav.my_class_groups')} />
      {groups === null ? (
        <EmptyState
          icon="alert"
          title={t('teacher_home.load_error_title')}
          body={t('teacher_home.load_error_body')}
        />
      ) : groups.length === 0 ? (
        <EmptyState
          icon="courses"
          title={t('teacher_home.no_active_title')}
          body={t('teacher_home.no_active_body')}
        />
      ) : (
        <ClassGroupList groups={groups} />
      )}
    </div>
  )
}
