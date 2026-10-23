import { setRequestLocale } from 'next-intl/server'
import { getStaffSession } from '@/lib/backoffice/session'
import type { Locale } from '@/lib/format'
import { AccountScreen } from '@/components/backoffice/account/account-screen'

/** The reader's own access, in the backoffice. See `AccountScreen`. */
export default async function AccountPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const user = await getStaffSession()
  return <AccountScreen locale={locale as Locale} user={user} teacherFileHref={null} />
}
