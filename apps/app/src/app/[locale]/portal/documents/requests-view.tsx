'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import type { RequestStatus, RequestType } from '@/lib/portal/types'
import { formatDate, formatMoney, type Locale } from '@/lib/format'
import { stackLabels } from '@/lib/table-stack'
import { Card, EmptyState, SectionTitle, StatusBadge } from '@/components/portal/ui'
import { requestTone } from '@/components/portal/status-tone'
import { Icon, type IconName } from '@/components/portal/icons'
import { ReceiptUploadForm, type ReceiptSubmission } from '@/components/portal/receipt-upload'
import { submitProcedureRequest, type ProcedureSubmitFailure } from '@/lib/portal/procedure-request'

/**
 * Trámites — every paid procedure the student can start from the portal
 * (docs/REGRAS-NEGOCIO.md §5). All of them follow the constancia pattern
 * (CLAUDE.md §1): a request with a payment attached — receipt, OCR ladder,
 * human queue — that only becomes a document / takes effect once the payment
 * is approved.
 *
 * Real since OOC-83, for what the API lists: today the constancia. Prices,
 * eligibility and the student's requests are the server's, and after a submit
 * the page reads them again rather than guessing the new state here.
 */

export interface EligibleEnrollment {
  enrollmentId: string
  courseName: string
}

export interface ProcedureView {
  type: RequestType
  priceCents: number
  currency: string
  eligible: EligibleEnrollment[]
}

export interface RequestView {
  id: string
  type: RequestType
  status: RequestStatus
  courseName: string
  createdAt: string
  priceCents: number
  currency: string
  resultUrl: string | null
}

const procedureIcon: Record<RequestType, IconName> = {
  enrollment_certificate: 'documents',
  certification_exam: 'star',
  makeup_exam: 'clipboard',
  enrollment_freeze: 'freeze',
}

export function RequestsView({
  procedures,
  initialRequests,
}: {
  procedures: ProcedureView[]
  initialRequests: RequestView[]
}) {
  const t = useTranslations('portal')
  const locale = useLocale() as Locale

  const router = useRouter()
  const requests = initialRequests
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<ProcedureSubmitFailure | null>(null)
  /* One key per attempt with the same data; a new key only after an answer that
     says nothing was paid, so a double tap on a bad connection pays once. */
  const attemptKey = useRef<string | null>(null)
  const [openType, setOpenType] = useState<RequestType | null>(null)
  const [enrollmentId, setEnrollmentId] = useState<string | null>(null)
  const [justSubmitted, setJustSubmitted] = useState(false)

  const open = procedures.find((p) => p.type === openType) ?? null
  const chosen =
    open?.eligible.find((e) => e.enrollmentId === enrollmentId) ??
    (open?.eligible.length === 1 ? open.eligible[0] : null)

  function startProcedure(type: RequestType) {
    setOpenType(type)
    setEnrollmentId(null)
    setJustSubmitted(false)
    setFailure(null)
  }

  async function submit(submission: ReceiptSubmission) {
    if (!open || !chosen || sending) return
    setSending(true)
    setFailure(null)
    attemptKey.current ??= crypto.randomUUID()
    const outcome = await submitProcedureRequest({
      kind: open.type,
      enrollmentId: chosen.enrollmentId,
      file: submission.file,
      method: submission.method,
      operationNumber: submission.operationNumber,
      idempotencyKey: attemptKey.current,
    })
    setSending(false)
    if (!outcome.ok) {
      setFailure(outcome.reason)
      if (outcome.reason !== 'generic') attemptKey.current = null
      // Somebody already sent it — a retry of a submit that did go through, or
      // another tab. The list on screen is what is out of date.
      if (outcome.reason === 'already_open') router.refresh()
      return
    }
    attemptKey.current = null
    setOpenType(null)
    setJustSubmitted(true)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Catalog — one list, and the form opens right under the row that was
          clicked instead of somewhere further down the page. */}
      <section>
        <div className="mb-3">
          <SectionTitle>{t('requests.catalog_title')}</SectionTitle>
        </div>
        {procedures.length === 0 ? (
          /* No procedure has a price in force: the catalog says how to ask
             meanwhile instead of offering a form that goes nowhere. */
          <Card className="p-6">
            <p className="text-sm text-muted-foreground">{t('requests.catalog_empty')}</p>
          </Card>
        ) : (
          <Card>
            <ul className="divide-y divide-line">
              {procedures.map((p) => {
                const active = openType === p.type
                const eligible = p.eligible.length > 0
                return (
                  <li key={p.type}>
                    {/* Quatro peças numa linha só cabem numa coluna larga. Num
                        telefone o `flex-wrap` sozinho não salvava: com
                        `min-w-0` o bloco de texto encolhia até uma palavra por
                        linha em vez de empurrar preço e botão para baixo. Então
                        o preço e o botão andam juntos num bloco que ocupa a
                        linha inteira até a coluna dar 32rem. */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:px-5">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky text-brand-blue">
                        <Icon name={procedureIcon[p.type]} size={20} />
                      </span>
                      <div className="min-w-40 flex-1">
                        <p className="text-sm font-semibold text-ink">
                          {t(`request_type.${p.type}`)}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {eligible
                            ? t(`requests.desc.${p.type}`)
                            : t('requests.not_eligible')}
                        </p>
                      </div>
                      <div className="flex w-full items-center justify-between gap-3 @lg/page:w-auto">
                        <span className="shrink-0 text-sm font-bold text-ink">
                          {formatMoney(p.priceCents, p.currency, locale)}
                        </span>
                        {eligible && (
                          <button
                            type="button"
                            onClick={() =>
                              active ? setOpenType(null) : startProcedure(p.type)
                            }
                            aria-expanded={active}
                            className={`inline-flex min-h-tap shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                              active
                                ? 'border-line bg-white text-muted-foreground hover:text-ink'
                                : 'border-brand-blue text-brand-blue hover:border-brand-yellow hover:bg-brand-yellow hover:text-ink'
                            }`}
                          >
                            {active ? t('requests.cancel') : t('requests.request_cta')}
                            <Icon
                              name="chevron-right"
                              size={15}
                              className={`transition-transform ${active ? 'rotate-90' : ''}`}
                            />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Inline flow, right where the click happened. */}
                    {active && open && (
                      <div className="border-t border-line bg-sky-soft px-5 py-4">
                        {open.type === 'enrollment_freeze' && (
                          <p className="mb-4 rounded-xl bg-white px-4 py-3 text-sm text-muted-foreground">
                            {t('requests.freeze_note')}
                          </p>
                        )}

                        <p className="mb-2 text-sm font-semibold text-ink">
                          {t('requests.choose_enrollment')}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {open.eligible.map((e) => {
                            const selected = chosen?.enrollmentId === e.enrollmentId
                            return (
                              <button
                                key={e.enrollmentId}
                                type="button"
                                onClick={() => setEnrollmentId(e.enrollmentId)}
                                aria-pressed={selected}
                                className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                                  selected
                                    ? 'border-brand-blue bg-brand-blue text-white'
                                    : 'border-line bg-white text-muted-foreground hover:border-brand-blue hover:text-brand-blue'
                                }`}
                              >
                                {e.courseName}
                              </button>
                            )
                          })}
                        </div>

                        {chosen && (
                          <div className="mt-4 rounded-xl border border-line bg-white p-4">
                            <ReceiptUploadForm
                              amountCents={open.priceCents}
                              currency={open.currency}
                              submitLabel={t('requests.submit')}
                              onSubmit={(submission) => void submit(submission)}
                              askOperationNumber
                              busy={sending}
                              error={failure ? t(`requests.error.${failure}`) : null}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </Card>
        )}
      </section>

      {justSubmitted && (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-600/20 bg-emerald-50 px-4 py-3.5 text-sm text-emerald-800">
          <span className="mt-0.5 shrink-0">
            <Icon name="check" size={18} />
          </span>
          <p>{t('requests.submitted_body')}</p>
        </div>
      )}

      {/* My requests */}
      <section>
        <div className="mb-3">
          <SectionTitle>{t('requests.my_title')}</SectionTitle>
        </div>
        {requests.length === 0 ? (
          <EmptyState
            title={t('requests.empty_title')}
            body={t('requests.empty_body')}
            icon={<Icon name="clipboard" size={24} />}
          />
        ) : (
          <Card>
            {/* Horizontal scroll lives on this wrapper, never on the page
                (CLAUDE.md §5, screen layout) — and no phone should have to use
                it: abaixo de 48rem de coluna a tabela vira lista, com o nome
                da coluna virando etiqueta da linha (`lib/table-stack.ts`). */}
            <div className="table-scroll overflow-x-auto">
              <table
                className="table-stack w-full text-sm"
                style={stackLabels([
                  t('requests.col_name'),
                  t('requests.col_course'),
                  t('requests.col_date'),
                  t('requests.col_price'),
                  t('requests.col_status'),
                  '',
                ])}
              >
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3 font-medium">
                      {t('requests.col_name')}
                    </th>
                    <th className="px-5 py-3 font-medium">
                      {t('requests.col_course')}
                    </th>
                    <th className="px-5 py-3 font-medium">
                      {t('requests.col_date')}
                    </th>
                    <th className="px-5 py-3 text-right font-medium">
                      {t('requests.col_price')}
                    </th>
                    <th className="px-5 py-3 font-medium">
                      {t('requests.col_status')}
                    </th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {requests.map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap px-5 py-3.5 font-semibold text-ink">
                        {t(`request_type.${r.type}`)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-muted-foreground">
                        {r.courseName}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-muted-foreground">
                        {formatDate(r.createdAt, locale)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-right font-semibold text-ink">
                        {formatMoney(r.priceCents, r.currency, locale)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5">
                        <StatusBadge
                          tone={requestTone[r.status]}
                          label={t(`request_status.${r.status}`)}
                        />
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-right">
                        {r.resultUrl && (
                          <a
                            href={r.resultUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-blue transition hover:text-brand-blue-deep"
                          >
                            <Icon name="download" size={15} />
                            {t('common.download')}
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>
    </div>
  )
}
