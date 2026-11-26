import { getTranslations, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { getStaffSession } from '@/lib/backoffice/session'
import { canBrowseCatalog, canDownloadGradeRecords } from '@/lib/backoffice/permissions'
import { listCatalogPeriods } from '@/lib/backoffice/catalog'
import { listGradeRecords } from '@/lib/grade-records/server'
import type { Locale } from '@/lib/format'
import { Card, EmptyState, PageHeader } from '@/components/backoffice/ui'
import { HelpHint } from '@/components/backoffice/help-hint'
import { GradeRecordsTable } from '@/components/grades/grade-records-table'

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

const selectClass =
  'min-h-tap rounded-lg border border-line bg-white px-3 py-1.5 text-sm text-ink outline-none focus:border-brand-blue sm:min-h-0'

/**
 * The teachers' actas de notas (OOC-176): every official grade register, the
 * newest confirmation first, with the counts and the download. What
 * administration pays a teacher against, and coordination's copy of it —
 * replacing the confirmation e-mail Coordinación/Asesoría sent by hand.
 *
 * The period filter needs the catalog's list, which billing does not read:
 * without it the filter is left out, never shown empty. The teacher filter
 * is built from the rows themselves, like the grade registers' list.
 */
export default async function GradeRecordsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')
  const staff = await getStaffSession()
  if (!canDownloadGradeRecords(staff)) notFound()

  const query = await searchParams
  const period = one(query.period) || undefined
  const teacher = one(query.teacher) || undefined
  const readsCatalog = canBrowseCatalog(staff)

  const [all, periods] = await Promise.all([
    listGradeRecords({ period }),
    readsCatalog ? listCatalogPeriods() : Promise.resolve(null),
  ])

  const teachers = [
    ...new Map(
      (all ?? []).filter((row) => row.teacherId).map((row) => [row.teacherId!, row.teacherName ?? row.teacherId!]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]))
  const rows = (all ?? []).filter((row) => (teacher ? row.teacherId === teacher : true))

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('grade_record.title')}
        actions={<HelpHint what={t('help.grade_record_page_what')} how={t('help.grade_record_page_how')} />}
      />
      <p className="text-sm text-muted-foreground">{t('grade_record.intro')}</p>

      <form method="get" className="flex flex-wrap items-end gap-2">
        {periods && (
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
            {t('grade_register.filter_period')}
            <select name="period" defaultValue={period ?? ''} className={selectClass}>
              <option value="">{t('grade_register.filter_all')}</option>
              {periods.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          {t('grade_register.filter_teacher')}
          <select name="teacher" defaultValue={teacher ?? ''} className={selectClass}>
            <option value="">{t('grade_register.filter_all')}</option>
            {teachers.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="min-h-tap rounded-lg bg-brand-blue px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-blue-deep sm:min-h-0"
        >
          {t('grade_register.filter_apply')}
        </button>
      </form>

      {all === null ? (
        <Card className="p-4">
          <EmptyState icon="alert" title={t('grade_record.load_error')} body={t('class_groups.load_error_body')} />
        </Card>
      ) : rows.length === 0 ? (
        <Card className="p-4">
          <EmptyState icon="check" title={t('grade_record.empty_title')} body={t('grade_record.empty_body')} />
        </Card>
      ) : (
        <GradeRecordsTable rows={rows} scope="staff" locale={locale as Locale} />
      )}
    </div>
  )
}
