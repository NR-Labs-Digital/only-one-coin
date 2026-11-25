import { getTranslations, setRequestLocale } from 'next-intl/server'
import { getPortalView } from '@/lib/portal/session'
import { formatDateNumeric, formatMoney } from '@/lib/portal/format'
import type { Locale, Payment } from '@/lib/portal/types'
import { Card, PageHeader, SectionTitle, StatusBadge } from '@/components/portal/ui'
import { paymentTone } from '@/components/portal/status-tone'
import { HelpHint } from '@/components/backoffice/help-hint'
import { MonthlyPaymentCard } from './monthly-payment-card'

/**
 * Pagos — the money side of the portal in one place: the due month of a
 * monthly (English) enrollment with its receipt upload (decision 02/09/2026),
 * and the history of everything already paid — packages, months and paid
 * procedures — each with the status of its receipt.
 */
export default async function PaymentsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale: raw } = await params
  const locale = raw as Locale
  setRequestLocale(raw)
  const t = await getTranslations('portal')
  const tb = await getTranslations('bo')

  const { enrollments, requests } = await getPortalView()

  /**
   * Monthly enrollments with something still for sale, one card each
   * (OOC-86). The card carries the enrollment's whole module ledger — what is
   * bought and what is still for sale — because a student checking what to
   * pay is also checking what they already paid.
   */
  const duePlans = enrollments.flatMap((e) => {
    // Only a confirmed seat buys more modules: the first purchase goes through Pagos first.
    if (e.seatStatus !== 'confirmed' || e.monthly === null) return []
    if (e.monthly.forSale.length === 0 || e.monthly.modulePriceCents === null) return []
    return [{ enrollment: e, monthly: e.monthly }]
  })

  /**
   * Every payment ever sent, newest first — dated by when the receipt went
   * in, the one date every row has (a payment still waiting on a person has
   * no settlement date yet). The row keeps
   * the course and what was bought apart — one column each — instead of gluing
   * them into a sentence: a column of names is what the eye scans down.
   */
  type HistoryRow = {
    id: string
    name: string
    type: 'package' | 'monthly' | 'procedure'
    payment: Payment
  }

  const history: HistoryRow[] = [
    ...enrollments.flatMap<HistoryRow>((e) =>
      e.payments.map<HistoryRow>((payment) => ({
        id: payment.id,
        name: e.course.name,
        type: e.billingMode,
        payment,
      })),
    ),
    ...requests.map<HistoryRow>((r) => ({
      id: r.payment.id,
      name: t(`request_type.${r.type}`),
      type: 'procedure',
      payment: r.payment,
    })),
  ].sort((a, b) => b.payment.submittedAt.localeCompare(a.payment.submittedAt))

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t('payments.title')} />

      {duePlans.length > 0 && (
        <section className="-mt-4">
          <div className="mb-3">
            <SectionTitle>{t('payments.due_title')}</SectionTitle>
          </div>
          <div className="flex flex-col gap-4">
            {duePlans.map(({ enrollment, monthly }) => (
              <MonthlyPaymentCard
                key={enrollment.id}
                enrollmentId={enrollment.id}
                courseName={enrollment.course.name}
                current={monthly.current}
                bought={monthly.bought}
                forSale={monthly.forSale}
                modulePriceCents={monthly.modulePriceCents ?? 0}
                currency={monthly.currency}
                locked={enrollment.classAccessLock === 'monthly_payment_due'}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3">
          <SectionTitle>{t('payments.history_title')}</SectionTitle>
        </div>
        {history.length === 0 ? (
          <Card className="p-6">
            <p className="text-sm text-muted-foreground">
              {t('payments.history_empty')}
            </p>
          </Card>
        ) : (
          <Card>
            {/* Horizontal scroll lives on this wrapper, never on the page
                (CLAUDE.md §5, screen layout) — same table idiom as Solicitudes. */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3 text-left font-medium">
                      {t('payments.col_name')}
                    </th>
                    <th className="px-5 py-3 text-center font-medium">
                      {t('payments.col_type')}
                    </th>
                    <th className="px-5 py-3 text-center font-medium">
                      {t('payments.col_date')}
                    </th>
                    <th className="px-5 py-3 text-right font-medium">
                      {t('payments.col_amount')}
                    </th>
                    <th className="px-5 py-3 text-center font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        {t('payments.col_status')}
                        <HelpHint
                          what={tb('help.portal_payment_status_what')}
                          how={tb('help.portal_payment_status_how')}
                        />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {history.map((row) => (
                    <tr key={row.id}>
                      {/* The only cell allowed to wrap: holding the name on one
                          line pushes Estado off the wrapper on a normal column,
                          and it is the one text with room to break. */}
                      <td className="min-w-48 px-5 py-3.5 text-left font-semibold text-ink">
                        {row.name}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-center text-muted-foreground">
                        {t(`payments.type_${row.type}`)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-center tabular-nums text-muted-foreground">
                        {formatDateNumeric(row.payment.submittedAt, locale)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-right tabular-nums font-semibold text-ink">
                        {formatMoney(
                          row.payment.amountCents,
                          row.payment.currency,
                          locale,
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-center">
                        <StatusBadge
                          tone={paymentTone[row.payment.status]}
                          label={t(`payment_status.${row.payment.status}`)}
                        />
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
