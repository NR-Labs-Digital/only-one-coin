'use client'

import { useActionState, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { updateOwnPhone, type OwnPhoneActionState } from '@/app/[locale]/portal/phone-actions'
import { Icon } from './icons'

/**
 * The one field of the file a portal account corrects itself (OOC-110): the
 * phone of the profile on screen. Read like its locked neighbours until
 * "Edit" opens the input; the rule it is held to is the API's (`PhoneField`).
 */
export function OwnPhoneField({ label, phone, profileId }: { label: string; phone: string; profileId: string }) {
  const t = useTranslations('portal.profile')
  const [editing, setEditing] = useState(false)
  const [state, formAction, pending] = useActionState<OwnPhoneActionState, FormData>(updateOwnPhone, { status: 'idle' })
  const shown = state.status === 'saved' ? state.phone : phone

  useEffect(() => {
    if (state.status === 'saved') setEditing(false)
  }, [state])

  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      {editing ? (
        <dd className="mt-1">
          <form action={formAction} className="flex flex-wrap items-start gap-2">
            <input type="hidden" name="profileId" value={profileId} />
            <input
              type="tel"
              name="phone"
              defaultValue={shown}
              autoComplete="tel"
              required
              maxLength={30}
              aria-label={label}
              aria-invalid={state.status === 'error'}
              aria-describedby={state.status === 'error' ? 'own-phone-error' : undefined}
              className="min-h-tap min-w-0 flex-1 basis-40 rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
            />
            <button
              type="submit"
              disabled={pending}
              className="inline-flex min-h-tap items-center justify-center rounded-lg bg-brand-blue px-4 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:opacity-60"
            >
              {pending ? t('phone_saving') : t('phone_save')}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={pending}
              className="inline-flex min-h-tap items-center justify-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition hover:text-ink"
            >
              {t('phone_cancel')}
            </button>
          </form>
          {state.status === 'error' && (
            <p id="own-phone-error" role="alert" className="mt-1.5 text-xs font-medium text-red-600">
              {t(`phone_error.${state.error}`)}
            </p>
          )}
          <p className="mt-1.5 text-xs text-muted-foreground">{t('phone_hint')}</p>
        </dd>
      ) : (
        <dd className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium text-ink">
          {shown}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex min-h-tap items-center gap-1 text-xs font-semibold text-brand-blue hover:text-brand-blue-deep"
          >
            <Icon name="pencil" size={13} />
            {t('phone_edit')}
          </button>
          {state.status === 'saved' && (
            <span role="status" className="text-xs font-medium text-emerald-700">
              {t('phone_saved')}
            </span>
          )}
        </dd>
      )}
    </div>
  )
}
