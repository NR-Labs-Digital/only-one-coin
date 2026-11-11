import { getTranslations, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { listCatalogClassGroups } from '@/lib/backoffice/catalog'
import { getStaffSession } from '@/lib/backoffice/session'
import { canBrowseCatalog } from '@/lib/backoffice/permissions'
import { agendaCatalogClassGroup, type AgendaClassGroup } from '@/lib/agenda'
import { isoToLimaDateTime } from '@/lib/backoffice/lima-date'
import { toMinutes } from '@/lib/backoffice/availability'
import { Card, EmptyState, PageHeader } from '@/components/backoffice/ui'
import { AcademicTabs } from '@/components/backoffice/academic-tabs'
import { TeacherCalendarView } from './teacher-calendar-view'

/**
 * The teachers' calendar (OOC-99): every class group with a teacher from the
 * roster, drawn on the same week/month grid the teacher reads in their own
 * agenda, with a filter by teacher. Read from the catalog list — the same one
 * the class group directory reads, so who sees it is who browses the catalog
 * (`canBrowseCatalog`; the API's CATALOG_READ_ROLES is what enforces it).
 * Nothing is stored: a class is a weekly slot landed between the first and
 * last day, as in the teacher's agenda.
 *
 * Without a period the API answers the 500 most recent class groups — the
 * ones a calendar is opened for. "Today" and "now" are read here, in Lima,
 * so the server and the client agree around midnight.
 */
export default async function TeacherCalendarPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()
  if (!canBrowseCatalog(staff.role)) notFound()

  const items = await listCatalogClassGroups()
  const now = isoToLimaDateTime(new Date().toISOString())

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('nav.academic')} />
      <AcademicTabs />
      {items === null ? (
        <Card className="p-4">
          <EmptyState
            icon="alert"
            title={t('class_groups.load_error_title')}
            body={t('class_groups.load_error_body')}
          />
        </Card>
      ) : (
        <TeacherCalendarView
          groups={items
            .map(agendaCatalogClassGroup)
            .filter((group): group is AgendaClassGroup => group !== null)}
          today={now.slice(0, 10)}
          nowMinutes={toMinutes(now.slice(11, 16))}
        />
      )}
    </div>
  )
}
