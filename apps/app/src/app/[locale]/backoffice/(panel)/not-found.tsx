import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { EmptyState } from '@/components/backoffice/ui'

/**
 * The panel's own dead end — reached whenever `requireFeature` 404s a
 * section that is off in production (`(gated)/layout.tsx`) or a page further
 * down calls `notFound()` for a record that does not exist. Same shape as
 * every other "nothing here" screen in the panel (`EmptyState`), so landing
 * here still looks like this product, not like Next's own page.
 *
 * Lives beside `layout.tsx` rather than inside `(gated)/`: the shell (sidebar,
 * header) still renders around it, which is what lets someone land here and
 * click their way back out instead of being stranded on a bare page.
 */
export default async function BackofficePanelNotFound() {
  const t = await getTranslations('bo')

  return (
    <div className="flex flex-col items-center gap-4 py-6">
      <div className="w-full max-w-md">
        <EmptyState
          icon="search"
          title={t('not_found.title')}
          body={t('not_found.body')}
        />
      </div>
      <Link
        href="/backoffice/home"
        className="text-sm font-semibold text-brand-blue hover:underline"
      >
        {t('not_found.back')}
      </Link>
    </div>
  )
}
