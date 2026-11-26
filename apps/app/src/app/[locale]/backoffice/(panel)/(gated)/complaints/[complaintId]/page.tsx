import { getTranslations, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { Link } from '@/i18n/navigation'
import { getStaffSession } from '@/lib/backoffice/session'
import { canAnswerComplaints, canBrowseStudents, canViewComplaints } from '@/lib/backoffice/permissions'
import { getComplaint } from '@/lib/backoffice/complaints'
import { getPlatformSettings } from '@/lib/backoffice/platform-settings'
import { formatDate, formatDateTime, formatMoney, type Locale } from '@/lib/format'
import { Card, EmptyState, Field, SectionTitle, StatusBadge } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { HelpHint } from '@/components/backoffice/help-hint'
import { AutoGrid } from '@/components/layout/auto-grid'
import { complaintTone } from '@/components/backoffice/complaint-tone'
import { ComplaintActions } from './complaint-actions'

/**
 * One sheet of the complaints book (OOC-58): what the consumer wrote — never
 * editable, the sheet is a legal record —, the deadline, who took it and the
 * answer. Taking and answering is `complaints.answer`; the analyst reads.
 */
export default async function ComplaintPage({
  params,
}: {
  params: Promise<{ locale: string; complaintId: string }>
}) {
  const { locale, complaintId } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')
  const staff = await getStaffSession()
  if (!canViewComplaints(staff)) notFound()

  const [sheet, settings] = await Promise.all([getComplaint(complaintId), getPlatformSettings()])
  if (sheet === 'not_found') notFound()

  const back = (
    <Link
      href="/backoffice/complaints"
      className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-ink"
    >
      <BoIcon name="arrow-left" size={16} />
      {t('complaints.back')}
    </Link>
  )

  if (sheet === null) {
    return (
      <div className="flex flex-col gap-5">
        {back}
        <Card className="p-4">
          <EmptyState icon="alert" title={t('complaints.load_error')} body={t('class_groups.load_error_body')} />
        </Card>
      </div>
    )
  }

  const lang = locale as Locale
  const notGiven = <span className="text-muted-foreground">{t('complaints.not_given')}</span>
  const consumer = sheet.consumer
  const consumerName = [consumer.firstName, consumer.lastName, consumer.secondLastName].filter(Boolean).join(' ')
  const address = [consumer.address, consumer.district, consumer.province, consumer.department].join(', ')

  return (
    <div className="flex flex-col gap-5">
      {back}

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-ink">
              {t('complaints.sheet_heading', { code: sheet.code })}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {`${t(`complaints.kind.${sheet.kind}`)} · ${t('complaints.filed_at', { date: formatDateTime(sheet.filedAt, lang) })}`}
            </p>
          </div>
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge tone={complaintTone[sheet.status]} label={t(`complaints.status.${sheet.status}`)} />
            {sheet.overdue && <StatusBadge tone="danger" label={t('complaints.overdue')} />}
            {sheet.answeredLate && <StatusBadge tone="warning" label={t('complaints.answered_late')} />}
            <HelpHint what={t('help.complaint_status_what')} how={t('help.complaint_status_how')} />
          </span>
        </div>
        <dl className="mt-4">
          <AutoGrid min="12rem" className="gap-4">
            <div className="min-w-0">
              <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('complaints.col_deadline')}
                {/* The number of days is the setting's, never typed in the copy;
                    without the settings read the (?) is left out. */}
                {settings && (
                  <HelpHint
                    what={t('help.complaint_deadline_what', { days: settings.complaintResponseBusinessDays })}
                    how={t('help.complaint_deadline_how')}
                  />
                )}
              </dt>
              <dd className="mt-0.5 text-sm font-medium text-ink">
                {t('complaints.due_on', { date: formatDate(sheet.dueOn, lang) })}
                {sheet.status !== 'answered' && !sheet.overdue && (
                  <span className="block text-xs text-muted-foreground">
                    {t('complaints.days_left', { count: sheet.businessDaysLeft })}
                  </span>
                )}
              </dd>
            </div>
            <Field label={t('complaints.form_locale_label')}>{t(`complaints.form_locale.${sheet.locale}`)}</Field>
            <div className="min-w-0">
              <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('complaints.student_label')}
                <HelpHint what={t('help.complaint_student_what')} how={t('help.complaint_student_how')} />
              </dt>
              <dd className="mt-0.5 text-sm font-medium text-ink">
                {sheet.student && !canBrowseStudents(staff) ? (
                  sheet.student.fullName
                ) : sheet.student ? (
                  <Link
                    href={`/backoffice/students/${sheet.student.studentId}`}
                    className="font-semibold text-brand-blue hover:underline"
                  >
                    {sheet.student.fullName}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">{t('complaints.no_student')}</span>
                )}
              </dd>
            </div>
          </AutoGrid>
        </dl>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <SectionTitle>{t('complaints.consumer_title')}</SectionTitle>
        <dl>
          <AutoGrid min="12rem" className="gap-4">
            <Field label={t('complaints.field_name')}>{consumerName}</Field>
            <Field label={t('complaints.field_document')}>
              {`${t(`national_id_type.${consumer.nationalIdType}`)} ${consumer.nationalId}`}
            </Field>
            <Field label={t('complaints.field_phone')}>{consumer.phone}</Field>
            <Field label={t('complaints.field_email')}>{consumer.email}</Field>
            <Field label={t('complaints.field_address')} wrap>
              {consumer.addressReference ? `${address} (${consumer.addressReference})` : address}
            </Field>
            <Field label={t('complaints.field_minor')}>
              {t(consumer.isMinor ? 'complaints.yes' : 'complaints.no')}
            </Field>
          </AutoGrid>
        </dl>
        {sheet.guardian && (
          <>
            <SectionTitle>{t('complaints.guardian_title')}</SectionTitle>
            <dl>
              <AutoGrid min="12rem" className="gap-4">
                <Field label={t('complaints.field_name')}>
                  {`${sheet.guardian.firstName} ${sheet.guardian.lastName}`}
                </Field>
                <Field label={t('complaints.field_document')}>
                  {`${t(`national_id_type.${sheet.guardian.nationalIdType}`)} ${sheet.guardian.nationalId}`}
                </Field>
              </AutoGrid>
            </dl>
          </>
        )}
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <SectionTitle>{t('complaints.sheet_title')}</SectionTitle>
        <dl>
          <AutoGrid min="12rem" className="gap-4">
            <Field label={t('complaints.field_good')}>{t(`complaints.good_type.${sheet.goodType}`)}</Field>
            <Field label={t('complaints.field_amount')}>
              {sheet.amountCents === null ? notGiven : formatMoney(sheet.amountCents, 'PEN', lang)}
            </Field>
            <Field label={t('complaints.field_purchased_on')}>
              {sheet.purchasedOn === null ? notGiven : formatDate(sheet.purchasedOn, lang)}
            </Field>
            <Field label={t('complaints.field_supplier')} wrap>
              {`${sheet.supplier.legalName} · RUC ${sheet.supplier.ruc}`}
            </Field>
          </AutoGrid>
        </dl>
        {[
          { label: t('complaints.field_description'), text: sheet.description },
          { label: t('complaints.field_detail'), text: sheet.detail },
          { label: t('complaints.field_request'), text: sheet.request },
        ].map(({ label, text }) => (
          <div key={label}>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-1 whitespace-pre-line break-words text-sm text-ink">{text}</p>
          </div>
        ))}
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <span className="flex items-center gap-1.5">
          <SectionTitle>{t('complaints.attention_title')}</SectionTitle>
        </span>
        <ul className="flex flex-col gap-1 text-sm text-ink">
          <li>{t('complaints.step_filed', { date: formatDateTime(sheet.filedAt, lang) })}</li>
          {sheet.taken && (
            <li>
              {t('complaints.step_taken', {
                name: sheet.taken.byName ?? t('complaints.someone'),
                date: formatDateTime(sheet.taken.at, lang),
              })}
            </li>
          )}
          {sheet.answered && (
            <li>
              {t('complaints.step_answered', {
                name: sheet.answered.byName ?? t('complaints.someone'),
                date: formatDateTime(sheet.answered.at, lang),
              })}
            </li>
          )}
        </ul>
        {sheet.answer !== null ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('complaints.answer_sent_title')}
            </p>
            <p className="mt-1 whitespace-pre-line break-words rounded-lg bg-sky-soft p-3 text-sm text-ink">
              {sheet.answer}
            </p>
          </div>
        ) : canAnswerComplaints(staff) ? (
          <ComplaintActions
            complaintId={sheet.id}
            taken={sheet.taken !== null}
            email={consumer.email}
            language={t(`complaints.form_locale.${sheet.locale}`)}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t('complaints.read_only')}</p>
        )}
      </Card>
    </div>
  )
}
