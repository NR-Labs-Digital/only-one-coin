import { getTranslations, setRequestLocale } from 'next-intl/server'
import { DOCUMENT_KINDS, getDocumentTemplate, isDocumentKind } from '@/lib/backoffice/document-templates'
import { Link } from '@/i18n/navigation'
import { EmptyState } from '@/components/backoffice/ui'
import { DocumentEditor } from '@/components/backoffice/documents/document-editor'
import { HelpHint } from '@/components/backoffice/help-hint'

/**
 * The text of the documents the platform prints (OOC-123): the teacher
 * contract, and since OOC-33 the constancia and the certificate. One editor at
 * a time, picked by `?kind=`. Edited visually beside the real PDF; published
 * versions are what every document is issued from.
 *
 * The platform owners' alone since 28/11/2026 (it was master and admin): by
 * e-mail domain, never by cargo, like the rest of the NR Labs area, whose
 * layout draws the header, the tabs and the locked state. The check that
 * counts is `.owners()` on the routes in `apps/api` (CLAUDE.md §8).
 */
export default async function DocumentSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ kind?: string }>
}) {
  const { locale } = await params
  const { kind: requested } = await searchParams
  // An unknown kind (stale link) opens the first one, never a 404.
  const kind = requested && isDocumentKind(requested) ? requested : DOCUMENT_KINDS[0]
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  /* A failure is shown as a failure: an empty editor that looked loaded would
     overwrite the real text on the first save. */
  const view = await getDocumentTemplate(kind)

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label={t('documents.kinds_label')} className="flex flex-wrap gap-2">
        {DOCUMENT_KINDS.map((item) => (
          <Link
            key={item}
            href={{ pathname: '/backoffice/platform/documents', query: { kind: item } }}
            aria-current={item === kind ? 'page' : undefined}
            className={
              item === kind
                ? 'inline-flex min-h-tap items-center rounded-full bg-brand-blue px-3.5 py-1.5 text-xs font-semibold text-white'
                : 'inline-flex min-h-tap items-center rounded-full border border-line px-3.5 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-sky hover:text-brand-blue'
            }
          >
            {t(`documents.kind.${item}`)}
          </Link>
        ))}
      </nav>
      {view ? (
        <>
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-1.5">
              <h2 className="text-base font-semibold text-ink">{t(`documents.kind.${kind}`)}</h2>
              <HelpHint what={t('help.admin_doc_versions_what')} how={t('help.admin_doc_versions_how')} />
            </span>
            <p className="text-sm text-muted-foreground">{t(`documents.intro.${kind}`)}</p>
          </div>
          {/* Keyed by kind: switching documents starts a fresh editor. */}
          <DocumentEditor key={kind} kind={kind} view={view} />
        </>
      ) : (
        <EmptyState icon="alert" title={t('documents.load_error_title')} body={t('documents.load_error_body')} />
      )}
    </div>
  )
}
