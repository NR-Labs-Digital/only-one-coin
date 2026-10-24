import { getTranslations, setRequestLocale } from 'next-intl/server'
import { listOwnClassGroups } from '@/lib/docente/teaching'
import { agendaClassGroup, type AgendaClassGroup } from '@/lib/docente/agenda'
import { isoToLimaDateTime } from '@/lib/backoffice/lima-date'
import { toMinutes } from '@/lib/backoffice/availability'
import { getFeatureFlags } from '@/lib/feature-flags/server'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { TeacherAgenda } from './teacher-agenda'

/**
 * Agenda — the teacher's classes on a calendar, week and month. Built from
 * `GET /teaching/class-groups`, the same scoped list as "My class groups"
 * (CLAUDE.md §8). "Today" and "now" are read here, in Lima, and handed down:
 * computed in the component they would hydrate a different day than the
 * server rendered around midnight.
 */
export default async function TeacherAgendaPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const [classGroups, flags] = await Promise.all([listOwnClassGroups(), getFeatureFlags('teacher')])
  const now = isoToLimaDateTime(new Date().toISOString())

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('nav.agenda')} />
      {classGroups === null ? (
        <EmptyState
          icon="alert"
          title={t('teacher_home.load_error_title')}
          body={t('teacher_home.load_error_body')}
        />
      ) : (
        <TeacherAgenda
          groups={classGroups
            .map(agendaClassGroup)
            .filter((group): group is AgendaClassGroup => group !== null)}
          today={now.slice(0, 10)}
          nowMinutes={toMinutes(now.slice(11, 16))}
          classLinks={flags['teacher.class_links']}
        />
      )}
    </div>
  )
}
