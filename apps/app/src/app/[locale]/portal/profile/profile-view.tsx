'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { Student } from '@/lib/portal/types'
import { formatDate, type Locale } from '@/lib/format'
import { Card, SectionTitle } from '@/components/portal/ui'
import { Icon } from '@/components/portal/icons'
import { AutoGrid } from '@/components/layout/auto-grid'
import { ProfilePreferences } from './profile-preferences'
import { DeviceNotifications } from './device-notifications'
import { OwnPhoneField } from '@/components/portal/own-phone-field'
import { HelpHint } from '@/components/backoffice/help-hint'

/**
 * Profile, read from the student's file (OOC-32): name, document, birth date,
 * the class-access Gmail (CLAUDE.md §1), the phone, and everything about the
 * guardian. Every field but the student's phone carries a padlock —
 * correcting the file is the coordination's, with an audit trail (OOC-74).
 * The phone is the account's own to correct (OOC-110, `OwnPhoneField`); the
 * mock's extra e-mail and phone never had a column to land in, so they left
 * with the mock.
 *
 * Plus what the student chooses about the portal itself (`ProfilePreferences`):
 * the language — and what the student sets on the device in hand
 * (`DeviceNotifications`, OOC-51): installing the portal, push on or off.
 * Neither the record nor a contact — a preference, and it lives
 * with the rest of what a person sets about themselves.
 */

function LockedField({
  label,
  lockedHint,
  help,
  children,
}: {
  label: string
  lockedHint: string
  /** The (?) by the label, for what a student would not know. */
  help?: { what: string; how?: string }
  children: React.ReactNode
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        <span title={lockedHint} className="text-muted-foreground/70">
          <Icon name="lock" size={12} />
        </span>
        {help && <HelpHint what={help.what} how={help.how} />}
      </dt>
      <dd className="mt-0.5 text-sm font-medium text-ink">{children}</dd>
    </div>
  )
}

export function ProfileView({ student, profileId }: { student: Student; profileId: string }) {
  const t = useTranslations('portal')
  const tb = useTranslations('bo')
  const locale = useLocale() as Locale
  const { guardian } = student

  const lockedHint = t('profile.locked_hint')

  return (
    <>
      <AutoGrid min="24rem" gap="gap-6">
        {/* Personal details */}
        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <SectionTitle>{t('profile.personal_title')}</SectionTitle>
            {student.isMinor && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-yellow/15 px-2.5 py-1 text-xs font-semibold text-brand-yellow-deep ring-1 ring-inset ring-brand-yellow-deep/20">
                <Icon name="shield" size={14} />
                {t('profile.minor_badge')}
              </span>
            )}
          </div>

          <AutoGrid as="dl" min="13rem" className="mt-4">
            <LockedField label={t('profile.full_name')} lockedHint={lockedHint}>
              {student.firstName} {student.lastName}
            </LockedField>
            <LockedField label={t('profile.id_label')} lockedHint={lockedHint}>
              {student.nationalIdType} {student.nationalId}
            </LockedField>
            <LockedField
              label={t('profile.email_label')}
              lockedHint={lockedHint}
              help={{ what: tb('help.portal_gmail_what'), how: tb('help.portal_gmail_how') }}
            >
              {student.email}
            </LockedField>
            <LockedField
              label={t('profile.birth_date_label')}
              lockedHint={lockedHint}
            >
              {formatDate(student.birthDate, locale)}
            </LockedField>
            <OwnPhoneField label={t('profile.phone_label')} phone={student.phone} profileId={profileId} />
          </AutoGrid>

        </Card>

        {/* Guardian — record only */}
        <Card className="p-5 sm:p-6">
          <SectionTitle>{t('profile.guardian_title')}</SectionTitle>
          {guardian ? (
            <>
              <AutoGrid as="dl" min="13rem" className="mt-4">
                <LockedField label={t('profile.full_name')} lockedHint={lockedHint}>
                  {guardian.firstName} {guardian.lastName}
                </LockedField>
                <LockedField
                  label={t('profile.relationship_label')}
                  lockedHint={lockedHint}
                >
                  {t(`relationship.${guardian.relationship}`)}
                </LockedField>
                <LockedField label={t('profile.id_label')} lockedHint={lockedHint}>
                  {guardian.nationalIdType} {guardian.nationalId}
                </LockedField>
                <LockedField label={t('profile.email_label')} lockedHint={lockedHint}>
                  {guardian.email}
                </LockedField>
                <LockedField label={t('profile.phone_label')} lockedHint={lockedHint}>
                  {guardian.phone}
                </LockedField>
              </AutoGrid>

              <div className="mt-5 rounded-xl bg-sky-soft p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <span className="text-brand-blue">
                    <Icon name="shield" size={18} />
                  </span>
                  {t('profile.consent_title')}
                  <HelpHint
                    what={tb('help.portal_consent_what')}
                    how={tb('help.portal_consent_how')}
                  />
                </div>
                {guardian.consent ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {t('profile.consent_accepted', {
                      date: formatDate(guardian.consent.acceptedAt, locale),
                    })}{' '}
                    ·{' '}
                    {t('profile.consent_version', {
                      version: guardian.consent.version,
                    })}
                  </p>
                ) : (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {t('profile.consent_none')}
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              {t('profile.guardian_none')}
            </p>
          )}
        </Card>
        <ProfilePreferences />
        <DeviceNotifications />
      </AutoGrid>

      <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <Icon name="lock" size={13} />
        {t('profile.edit_note')}
      </p>
    </>
  )
}
