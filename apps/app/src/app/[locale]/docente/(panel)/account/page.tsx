import { setRequestLocale } from 'next-intl/server'
import { getTeacherSession } from '@/lib/backoffice/session'
import type { Locale } from '@/lib/format'
import { AccountScreen } from '@/components/backoffice/account/account-screen'

/** The teacher's own access — the same screen as the backoffice's, own door. */
export default async function TeacherAccountPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const user = await getTeacherSession()
  return (
    <AccountScreen locale={locale as Locale} user={user} teacherFileHref="/docente/profile" />
  )
}
