import { getTranslations, setRequestLocale } from 'next-intl/server'
import { listClassGroupsFor } from '@/lib/backoffice/mock-data'
import { getTeacherSession } from '@/lib/backoffice/session'
import { isoToLimaDateTime } from '@/lib/backoffice/lima-date'
import { toMinutes } from '@/lib/backoffice/availability'
import { PageHeader } from '@/components/backoffice/ui'
import { TeacherAgenda } from './teacher-agenda'

/**
 * Agenda — the teacher's classes on a calendar, week and month. Built from
 * their own class groups only, scoped by the session's `teacherId` (CLAUDE.md
 * §8). "Today" and "now" are read here, in Lima, and handed down: computed in
 * the component they would hydrate a different day than the server rendered
 * around midnight.
 */
export default async function TeacherAgendaPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getTeacherSession()
  /* A closed group has nothing left to put on a calendar. */
  const groups = listClassGroupsFor(staff).filter((group) => group.status !== 'closed')
  const now = isoToLimaDateTime(new Date().toISOString())

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('nav.agenda')} />
      <TeacherAgenda
        groups={groups}
        today={now.slice(0, 10)}
        nowMinutes={toMinutes(now.slice(11, 16))}
      />
    </div>
  )
}
