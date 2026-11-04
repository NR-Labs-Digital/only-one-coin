import { getTranslations, setRequestLocale } from 'next-intl/server'
import { getPortalView } from '@/lib/portal/session'
import { formatDate } from '@/lib/portal/format'
import type { Locale } from '@/lib/portal/types'
import {
  Card,
  EmptyState,
  PageHeader,
  SectionTitle,
  StatusBadge,
} from '@/components/portal/ui'
import { documentTone } from '@/components/portal/status-tone'
import { Icon } from '@/components/portal/icons'
import { AutoGrid } from '@/components/layout/auto-grid'
import {
  RequestsView,
  type ProcedureView,
  type RequestView,
} from './requests-view'

/**
 * Documentos — everything the student's paperwork lives in, in one place: the
 * documents already issued (or waiting to be) and the paid procedures that
 * produce them. They were two screens, and a student looking for a constancia
 * had to know that "Solicitações" was where you buy the document that
 * "Documentos" would later hand you.
 */

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale: raw } = await params
  const locale = raw as Locale
  setRequestLocale(raw)
  const t = await getTranslations('portal')

  const { enrollments, documents, procedures, requests } = await getPortalView()
  const enrollmentOf = (enrollmentId: string) =>
    enrollments.find((e) => e.id === enrollmentId)
  const courseName = (enrollmentId: string) =>
    enrollmentOf(enrollmentId)?.course.name ?? ''

  const procedureViews: ProcedureView[] = procedures.map((p) => ({
    type: p.type,
    priceCents: p.priceCents,
    currency: p.currency,
    eligible: p.eligible,
  }))

  const requestViews: RequestView[] = requests.map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    courseName: r.courseName,
    createdAt: r.createdAt,
    priceCents: r.priceCents,
    currency: r.currency,
    resultUrl: r.resultUrl,
  }))

  return (
    <div>
      <PageHeader title={t('documents.title')} />

      <div className="mb-3">
        <SectionTitle>{t('documents.mine_title')}</SectionTitle>
      </div>

      {documents.length === 0 ? (
        <EmptyState
          title={t('documents.empty_title')}
          body={t('documents.empty_body')}
          icon={<Icon name="documents" size={24} />}
        />
      ) : (
        <AutoGrid as="ul" min="18rem">
          {documents.map((doc) => (
            <Card key={doc.id} as="li" className="flex flex-col gap-4 p-5">
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-sky text-brand-blue">
                  <Icon name="documents" size={22} />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold text-ink">
                    {t(`document_type.${doc.type}`)}
                  </h2>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {courseName(doc.enrollmentId)}
                  </p>
                </div>
                <StatusBadge
                  tone={documentTone[doc.status]}
                  label={t(`document_status.${doc.status}`)}
                />
              </div>

              {doc.status === 'available' ? (
                <div className="flex items-center justify-between gap-3">
                  {doc.issuedAt && (
                    <span className="text-xs text-muted-foreground">
                      {t('documents.issued_on', {
                        date: formatDate(doc.issuedAt, locale),
                      })}
                    </span>
                  )}
                  <a
                    href={doc.fileUrl ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-full bg-brand-blue px-4 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-brand-yellow hover:text-ink"
                  >
                    <Icon name="download" size={16} />
                    {t('common.download')}
                  </a>
                </div>
              ) : null}
            </Card>
          ))}
        </AutoGrid>
      )}

      {/* The procedures that produce those documents, on the same page: the
          student asks for the constancia here and picks it up above. */}
      <div className="mt-8">
        <RequestsView procedures={procedureViews} initialRequests={requestViews} />
      </div>
    </div>
  )
}
