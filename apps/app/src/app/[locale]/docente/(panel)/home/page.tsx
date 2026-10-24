import { setRequestLocale } from 'next-intl/server'
import { getTeacherSession } from '@/lib/backoffice/session'
import type { Locale } from '@/lib/format'
import { TeacherHome } from './teacher-home'

/** Where the docente portal starts — see `TeacherHome`. */
export default async function TeacherHomePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const staff = await getTeacherSession()
  return <TeacherHome staff={staff} locale={locale as Locale} />
}
