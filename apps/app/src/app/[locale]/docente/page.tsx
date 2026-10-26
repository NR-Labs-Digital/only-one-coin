import { getTranslations, setRequestLocale } from 'next-intl/server'
import { AuthBannerLayout } from '@/components/auth/auth-banner-layout'
import { StaffLoginForm } from '@/components/backoffice/staff-login-form'

/**
 * The docente portal's own door. Teachers no longer sign in through the
 * backoffice: they get a screen of their own, with their own address
 * (`/docente`), their own shell and nothing of the administration in it.
 *
 * Own door, same lock: the form posts to the same Better Auth as every other
 * login (one auth backend, one user registry — `apps/app/CLAUDE.md`), and the
 * role read server-side on the other side decides who stays. A non-teacher
 * who signs in here lands on the backoffice; a teacher who signs in there
 * lands here (CLAUDE.md §8).
 */
export default async function TeacherLoginPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo.teacher_portal')

  /* Blue where the backoffice is navy, plus the badge, so nobody mistakes one
     door for the other. */
  return (
    <AuthBannerLayout door="teacher" badge={t('badge')}>
      <StaffLoginForm
        homeHref="/docente/home"
        heading={{ title: t('login_title'), subtitle: t('login_subtitle') }}
      />
    </AuthBannerLayout>
  )
}
