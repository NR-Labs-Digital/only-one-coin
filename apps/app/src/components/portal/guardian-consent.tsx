'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { GuardianConsentActionState } from '@/app/[locale]/portal/consent-actions'
import { Icon } from './icons'
import { Card } from './ui'

/**
 * What a guardian's account sees on a child's profile while the consent is
 * pending (OOC-72): the consent text and the box to accept it, in place of
 * every screen of that profile. The other profiles stay one switch away.
 *
 * The text is the checkout's own (`enrollment.step.student.consent_label`),
 * read from that key on purpose: the version stamped on the record names one
 * text, and two copies would drift apart.
 *
 * A screen gate, not authorization: the API answers the guardian's reads as
 * before (they are the guardian on file); what waits for the consent is the
 * portal showing the child's data to them.
 */
export function GuardianConsentGate({
  childFirstName,
  profileId,
  version,
  acceptAction,
}: {
  childFirstName: string
  profileId: string
  version: string
  acceptAction: (state: GuardianConsentActionState, formData: FormData) => Promise<GuardianConsentActionState>
}) {
  const t = useTranslations('portal.guardian_consent')
  const consentText = useTranslations('enrollment.step.student')
  const router = useRouter()
  const [state, formAction, pending] = useActionState(acceptAction, { status: 'idle' })

  // The layout is not re-run on its own after an action: refresh it, so the
  // profile opens on its real screens.
  useEffect(() => {
    if (state.status === 'accepted') router.refresh()
  }, [state.status, router])

  return (
    <div className="mx-auto max-w-2xl">
      <Card as="section" className="p-5 sm:p-7">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sky text-brand-blue-deep">
            <Icon name="shield" size={20} />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{t('title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('body', { name: childFirstName })}</p>
          </div>
        </div>

        <form action={formAction} className="mt-6">
          <input type="hidden" name="profileId" value={profileId} />
          <input type="hidden" name="version" value={version} />
          <label className="flex items-start gap-3 rounded-xl border border-line bg-sky-soft p-4">
            <input
              type="checkbox"
              name="accepted"
              required
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-brand-blue focus:ring-brand-blue"
            />
            <span className="min-w-0 text-sm text-ink">
              {consentText('consent_label')}
              <span className="mt-1 block text-xs text-muted-foreground">{t('version_note', { version })}</span>
            </span>
          </label>

          {state.status === 'error' && (
            <p role="alert" className="mt-3 text-sm font-medium text-red-600">
              {state.error === 'outdated' ? t('error_outdated') : t('error_generic')}
            </p>
          )}

          <button
            type="submit"
            disabled={pending || state.status === 'accepted'}
            className="mt-5 inline-flex min-h-tap w-full items-center justify-center rounded-xl bg-brand-blue px-5 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:opacity-60 sm:w-auto"
          >
            {pending || state.status === 'accepted' ? t('submitting') : t('submit')}
          </button>
          <p className="mt-4 text-xs text-muted-foreground">{t('footnote')}</p>
        </form>
      </Card>
    </div>
  )
}

/**
 * What the minor's own account sees while the guardian has not accepted
 * (OOC-72): a notice, nothing blocked — class, Classroom and payments go on.
 * The student cannot accept on the guardian's behalf.
 */
export function GuardianConsentNotice() {
  const t = useTranslations('portal.guardian_consent')
  return (
    <div
      role="status"
      className="mb-6 flex items-start gap-3 rounded-xl border border-brand-yellow-deep/25 bg-brand-yellow/15 p-4 text-sm text-ink"
    >
      <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-brand-yellow-deep" />
      <div className="min-w-0">
        <p className="font-semibold">{t('notice_title')}</p>
        <p className="mt-0.5 text-muted-foreground">{t('notice_body')}</p>
      </div>
    </div>
  )
}
