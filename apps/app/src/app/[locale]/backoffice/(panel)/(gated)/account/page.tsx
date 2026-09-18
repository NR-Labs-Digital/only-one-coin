import { getTranslations, setRequestLocale } from 'next-intl/server'
import { getStaffSession } from '@/lib/backoffice/session'
import { initials, type Locale } from '@/lib/format'
import {
  Card,
  Field,
  PageHeader,
  SectionTitle,
  StatusBadge,
} from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { AutoGrid } from '@/components/layout/auto-grid'
import { Link } from '@/i18n/navigation'
import { AccountPassword } from './account-password'
import { AccountLanguage } from './account-language'

/**
 * The one screen in the panel that is about the reader rather than about the
 * institution: their own access. It manages what a person can change about
 * themselves without asking anybody — password, plus the language the panel
 * speaks to them in.
 *
 * What it deliberately does not edit: name, login e-mail and role. Those are
 * identity, not access. The role in particular is written only by the dedicated
 * promotion usecase, never by the account's owner (CLAUDE.md §8) — offering the
 * field here, even greyed out, would be the first step of the wrong habit.
 *
 * No role gate: every staff member has an account, so every staff member opens
 * this page. It is scoped by the session, and the session is read server-side
 * from the authenticated user's row — never from anything the client sends.
 */
export default async function AccountPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale: raw } = await params
  const locale = raw as Locale
  setRequestLocale(raw)
  const t = await getTranslations('bo')

  const user = await getStaffSession()
  const fullName = `${user.firstName} ${user.lastName}`

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('account.title')} />

      <AutoGrid min="24rem" gap="gap-5">
        <Card className="p-5">
          <SectionTitle icon="staff">{t('account.identity_title')}</SectionTitle>

          <div className="mt-4 flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sky text-sm font-semibold text-brand-blue-deep">
              {initials(user.firstName, user.lastName)}
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-base font-semibold text-ink">
                {fullName}
              </span>
              <span className="truncate text-sm text-muted-foreground">
                {user.email}
              </span>
            </span>
          </div>

          <AutoGrid as="dl" min="11rem" className="mt-5">
            <Field label={t('account.role_label')}>
              <StatusBadge tone="info" dot={false} label={t(`role.${user.role}`)} />
            </Field>
          </AutoGrid>

          <p className="mt-5 flex items-start gap-2 rounded-lg bg-sky-soft px-3 py-2 text-xs text-muted-foreground">
            <BoIcon name="shield" size={14} className="mt-0.5 shrink-0" />
            {t('account.identity_note')}
          </p>

          {/* A teacher's own record is the one page of the roster they own, so
              the account points at it instead of re-listing its data here. */}
          {user.teacherId && (
            <Link
              href={`/backoffice/teachers/${user.teacherId}`}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-blue transition hover:text-ink"
            >
              <BoIcon name="teachers" size={16} />
              {t('account.teacher_file_link')}
              <BoIcon name="chevron-right" size={14} />
            </Link>
          )}
        </Card>

        <AccountLanguage />
      </AutoGrid>

      <Card>
        <AccountPassword updatedAt={null} locale={locale} />
      </Card>

      <p className="flex items-start gap-2 rounded-lg border border-dashed border-line bg-sky-soft px-3 py-2 text-xs text-muted-foreground">
        <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
        {t('account.audit_notice')}
      </p>
    </div>
  )
}
