import { getTranslations, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { listCatalogLanguages } from '@/lib/backoffice/catalog'
import { getStaffSession } from '@/lib/backoffice/session'
import { canBrowseCatalog, canCreateCourse } from '@/lib/backoffice/permissions'
import { Card, EmptyState, PageHeader } from '@/components/backoffice/ui'
import { AcademicTabs } from '@/components/backoffice/academic-tabs'
import { LanguagesView } from './languages-view'

/**
 * The language list the catalog is filed under (OOC-128). Read by whoever
 * reads the catalog; opened, renamed and retired by whoever opens a course —
 * the same gate the API declares on the routes (CLAUDE.md §8).
 */
export default async function LanguagesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()
  if (!canBrowseCatalog(staff.role)) notFound()
  const languages = await listCatalogLanguages()

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('nav.academic')} />
      <AcademicTabs />
      {languages === null ? (
        <Card className="p-4">
          <EmptyState icon="alert" title={t('languages.load_error_title')} body={t('languages.load_error_body')} />
        </Card>
      ) : (
        <LanguagesView languages={languages} canManage={canCreateCourse(staff.role)} />
      )}
    </div>
  )
}
