import { getTranslations, setRequestLocale } from 'next-intl/server'
import { getPortalView } from '@/lib/portal/session'
import { PageHeader } from '@/components/portal/ui'
import { ProfileView } from './profile-view'

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('portal')

  const { student, profileId } = await getPortalView()

  return (
    <div>
      <PageHeader title={t('profile.title')} />
      <ProfileView student={student} profileId={profileId} />
    </div>
  )
}
