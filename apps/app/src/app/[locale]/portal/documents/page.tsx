import { getTranslations, setRequestLocale } from 'next-intl/server'
import { getPortalView } from '@/lib/portal/session'
import { Card, PageHeader } from '@/components/portal/ui'
import { getAttachments } from '@/lib/attachments/server'
import { AttachmentsSection } from '@/components/attachments/attachments-section'
import {
  RequestsView,
  type ProcedureView,
  type RequestView,
} from './requests-view'

/**
 * Documentos — the student's paperwork in one place (OOC-148). On top, one
 * list of every document on the student's file, each labelled by who sent it:
 * the coordination (from the panel) or the student (from here). Below, the
 * paid procedures (Trámites) — the student asks for the constancia on the same
 * page they will later find it on.
 *
 * The block of issued documents that sat above the list left: it had no
 * backend and always rendered empty. The constancia and the certificate join
 * the same list with their own label when they are issued (OOC-33).
 */

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('portal')

  const [{ procedures, requests }, attachments] = await Promise.all([
    getPortalView(),
    getAttachments({ kind: 'portal' }),
  ])

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

      {/* Every document on the student's file — sent by them or attached by
          the coordination (OOC-143), labelled by origin (OOC-148). Never an
          issued document. */}
      <Card className="p-5">
        <AttachmentsSection
          scope={{ kind: 'portal' }}
          initial={attachments}
          variant="portal"
          canUpload
          canRemove={false}
        />
      </Card>

      {/* The paid procedures, on the same page: the student asks for the
          constancia here. */}
      <div className="mt-8">
        <RequestsView procedures={procedureViews} initialRequests={requestViews} />
      </div>
    </div>
  )
}
