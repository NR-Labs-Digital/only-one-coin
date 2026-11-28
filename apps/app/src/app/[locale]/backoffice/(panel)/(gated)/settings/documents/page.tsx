import { redirect } from '@/i18n/navigation'

/**
 * The document templates moved into the owners' own area (28/11/2026), beside
 * Funcionalidades and the backups. The old address keeps working for whoever
 * has it bookmarked.
 */
export default async function LegacyDocumentSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ kind?: string }>
}) {
  const { locale } = await params
  const { kind } = await searchParams
  redirect({
    href: kind ? { pathname: '/backoffice/platform/documents', query: { kind } } : '/backoffice/platform/documents',
    locale,
  })
}
