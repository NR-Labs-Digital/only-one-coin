'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  PERMISSION_AREAS,
  PERMISSION_CATALOG,
  type PermissionAccess,
  type PermissionArea,
  type PermissionGrant,
  type PermissionKey,
} from '@ooc/domain/permission-catalog'
import { groupByArea, type StaffProfileItem } from '@/lib/backoffice/permission-matrix'
import { StatusBadge } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/* What the cargo list and a cargo's own page share (OOC-57, OOC-183). */

export type CatalogEntry = { key: PermissionKey; area: PermissionArea; access: PermissionAccess; grant?: PermissionGrant }

export const ENTRIES = PERMISSION_CATALOG as readonly CatalogEntry[]
export const GROUPS = groupByArea(ENTRIES, PERMISSION_AREAS)

export const fieldClass =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

export const labelClass = 'text-xs font-medium uppercase tracking-wide text-muted-foreground'

export const primaryButtonClass =
  'inline-flex min-h-tap items-center justify-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-blue'

export const editButtonClass =
  'inline-flex min-h-tap items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-brand-blue transition hover:border-brand-blue/40 hover:bg-sky'

export const dangerButtonClass =
  'inline-flex min-h-tap items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600 transition hover:border-red-400 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-line disabled:text-slate-400 disabled:hover:bg-white'

export const secondaryButtonClass =
  'inline-flex min-h-tap items-center justify-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-60'

/** The API's refusals this screen explains; anything else is a generic failure. */
const ERROR_REASONS = [
  'staff_profile.name_taken',
  'staff_profile.name_invalid',
  'staff_profile.beyond_own_permissions',
  'staff_profile.own_profile',
  'staff_profile.locked',
  'staff_profile.in_use',
  'staff_profile.permission_not_grantable',
] as const

export type ErrorReason = (typeof ERROR_REASONS)[number] | 'failed'

function errorOf(reason: string | undefined): ErrorReason {
  return (ERROR_REASONS as readonly string[]).includes(reason ?? '') ? (reason as ErrorReason) : 'failed'
}

export async function send(url: string, method: 'POST' | 'PATCH', body?: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: ErrorReason }> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null)
  if (!response) return { ok: false, error: 'failed' }
  if (!response.ok) {
    const parsed = (await response.json().catch(() => null)) as { reason?: string } | null
    return { ok: false, error: errorOf(parsed?.reason) }
  }
  return { ok: true, data: response.status === 204 ? null : await response.json().catch(() => null) }
}

/** Why a switch cannot be flipped here, or null when it can. */
export function lockReason(entry: CatalogEntry, viewer: ReadonlySet<string>): string | null {
  if (entry.grant === 'teacher') return 'permissions.grant_teacher'
  if (entry.grant === 'owners') return 'permissions.grant_owners'
  if (entry.grant === 'everyone') return 'permissions.grant_everyone'
  if (!viewer.has(entry.key)) return 'permissions.not_held'
  return null
}

export function RetireDialog({
  profile,
  label,
  onClose,
  onRetired,
}: {
  profile: StaffProfileItem
  label: string
  onClose: () => void
  onRetired: () => void
}) {
  const t = useTranslations('bo')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ErrorReason | null>(null)

  async function retire() {
    setPending(true)
    setError(null)
    const result = await send(`/api/v1/staff/profiles/${profile.id}/retire`, 'POST')
    setPending(false)
    if (result.ok) onRetired()
    else setError(result.error)
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('permissions.cancel')} className="bg-white">
        <DialogHeader className="gap-2 border-b border-line p-5 pr-14">
          <DialogTitle className="text-base font-semibold text-ink">{t('permissions.retire_title')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 p-5 text-sm text-ink">
          <p>
            {profile.members > 0
              ? t('permissions.retire_in_use', { count: profile.members })
              : t('permissions.retire_body', { name: label })}
          </p>
          {error && (
            <p role="alert" className="font-semibold text-red-600">
              {t(`permissions.error.${error}`)}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-line p-5 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            {t('permissions.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void retire()}
            disabled={pending || profile.members > 0}
            className="inline-flex min-h-tap items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('permissions.retire_confirm')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ActionLabel({ entry }: { entry: CatalogEntry }) {
  const t = useTranslations('bo')
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>{t(`permissions.capability.${entry.key}`)}</span>
      {entry.grant === 'owners' && <StatusBadge tone="info" dot={false} label={t('permissions.owners_only')} />}
    </span>
  )
}

/** On/off control; the `<label>` around it names it and makes the whole row clickable. */
export function Switch({
  checked,
  mixed = false,
  disabled,
  onChange,
}: {
  checked: boolean
  /** Part of what the switch stands for is on: a half-filled track, knob in the middle. A switch has no third state in ARIA, so it reads as off and the label says "partly". */
  mixed?: boolean
  disabled: boolean
  onChange: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked && !mixed}
      disabled={disabled}
      onClick={onChange}
      className={`relative mt-px inline-flex h-5 w-9 shrink-0 items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30 disabled:cursor-not-allowed disabled:opacity-50 ${
        mixed ? 'bg-brand-blue/45' : checked ? 'bg-brand-blue' : 'bg-slate-200'
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
          mixed ? 'translate-x-2.5' : checked ? 'translate-x-[1.125rem]' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

export function Mark({ allowed }: { allowed: boolean }) {
  const t = useTranslations('bo')
  return allowed ? (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
      <BoIcon name="check" size={14} />
      <span className="sr-only">{t('permissions.allowed')}</span>
    </span>
  ) : (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-slate-300">
      <span aria-hidden="true" className="inline-block h-0.5 w-3 rounded bg-current" />
      <span className="sr-only">{t('permissions.denied')}</span>
    </span>
  )
}
