import { getTranslations } from 'next-intl/server'
import type { Locale } from '@/lib/format'
import type { GradeRecordRow } from '@/lib/grade-records/types'
import { BoIcon } from '@/components/backoffice/icons'
import { HelpHint } from '@/components/backoffice/help-hint'
import { GradeRecordsTable } from '@/components/grades/grade-records-table'

/**
 * The teacher's actas de notas (OOC-176): one per official grade register of
 * their own runs, the class group closed or not — the document their payment
 * goes by. Scoped by the session in the API. Nothing official yet, nothing
 * shown; a failed read says so.
 */
export async function OwnGradeRecords({ records, locale }: { records: GradeRecordRow[] | null; locale: Locale }) {
  const t = await getTranslations('bo')

  if (records === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <BoIcon name="alert" size={16} className="text-amber-700" />
        {t('grade_record.load_error')}
      </p>
    )
  }
  if (records.length === 0) return null

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
          <BoIcon name="download" size={16} className="text-brand-blue" />
          {t('grade_record.own_title')}
          <HelpHint what={t('help.grade_record_own_what')} how={t('help.grade_record_own_how')} />
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('grade_record.own_subtitle')}</p>
      </div>
      <GradeRecordsTable rows={records} scope="teacher" locale={locale} />
    </section>
  )
}
