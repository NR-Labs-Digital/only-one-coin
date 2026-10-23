import Image from 'next/image'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { LanguageGlobe } from '@/components/language-globe'
import { BoIcon } from '@/components/backoffice/icons'
import { BackofficeLoginForm } from '../backoffice/backoffice-login-form'

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

  const highlights = [
    { icon: 'edit' as const, title: t('highlight_grades') },
    { icon: 'clock' as const, title: t('highlight_schedule') },
    { icon: 'video' as const, title: t('highlight_classes') },
  ]

  return (
    <div className="grid min-h-dvh bg-sky-soft lg:grid-cols-[1.05fr_0.95fr]">
      {/* Brand panel — blue where the backoffice is navy, so nobody mistakes
          one door for the other. Desktop only; the phone gets the header. */}
      <aside className="relative hidden overflow-hidden bg-brand-blue px-12 py-14 lg:flex lg:flex-col">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-28 h-96 w-96 rounded-full bg-brand-yellow/30 blur-3xl"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-white/20 blur-3xl"
        />

        <div className="relative flex items-center gap-3">
          <Image
            src="/brand/logo.png"
            alt="Only One Coin"
            width={768}
            height={127}
            priority
            className="h-9 w-auto"
          />
          <span className="rounded-full bg-brand-yellow px-3 py-1 text-xs font-bold uppercase tracking-wide text-ink">
            {t('badge')}
          </span>
        </div>

        <div className="relative my-auto max-w-md">
          <h2 className="text-4xl font-semibold leading-tight text-white">
            {t('brand_title')}
          </h2>

          <ul className="mt-8 flex flex-col gap-4">
            {highlights.map(({ icon, title }) => (
              <li key={title} className="flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/15 text-brand-yellow">
                  <BoIcon name={icon} size={18} />
                </span>
                <span className="text-sm font-semibold text-white">{title}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="flex flex-col px-6 py-8 sm:px-10 lg:px-14 lg:py-12">
        <div className="mb-10 flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 lg:hidden">
            <Image
              src="/brand/logo.png"
              alt="Only One Coin"
              width={768}
              height={127}
              className="h-7 w-auto"
            />
            <span className="rounded-full bg-brand-yellow px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-ink">
              {t('badge')}
            </span>
          </span>
          <span className="hidden lg:inline" />
          <LanguageGlobe />
        </div>

        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
            <BackofficeLoginForm
              homeHref="/docente/home"
              heading={{ title: t('login_title'), subtitle: t('login_subtitle') }}
            />
          </div>
        </div>
      </main>
    </div>
  )
}
