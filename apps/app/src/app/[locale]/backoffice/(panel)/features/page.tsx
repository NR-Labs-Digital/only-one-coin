import { redirect } from '@/i18n/navigation'

/**
 * Funcionalidades moved into the owners' own area (OOC-153), beside the
 * backups. The old address keeps working for whoever has it bookmarked.
 */
export default async function LegacyFeatureFlagsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  redirect({ href: '/backoffice/platform/features', locale })
}
