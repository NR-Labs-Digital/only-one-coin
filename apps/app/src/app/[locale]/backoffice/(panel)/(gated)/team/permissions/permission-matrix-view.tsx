'use client'

import { useEffect, useState, useTransition, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import type { StaffProfileItem } from '@/lib/backoffice/permission-matrix'
import type { StaffMemberRow } from '@/lib/backoffice/types'
import { Card, StatusBadge } from '@/components/backoffice/ui'
import { Toast } from '@/components/backoffice/controls'
import { BoIcon } from '@/components/backoffice/icons'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ENTRIES,
  RetireDialog,
  fieldClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  send,
  type ErrorReason,
} from './permission-shared'

/** A square, icon-only action beside a cargo; its name rides on `aria-label` and the hover title. */
const iconButtonClass =
  'inline-flex h-10 w-10 items-center justify-center rounded-lg border bg-white transition'

/**
 * The cargos as a plain list (OOC-57, OOC-183): each one with who holds it,
 * a button to its permissions and — for a cargo created in Equipo — one to
 * delete it. Editing a cargo — its name and what it can do — is its own page.
 */
export function PermissionMatrixView({
  profiles,
  people,
  viewerPermissions,
  canManage,
}: {
  profiles: StaffProfileItem[]
  /** The team directory; null for who reads the cargos but not the people. */
  people: StaffMemberRow[] | null
  viewerPermissions: readonly string[]
  canManage: boolean
}) {
  const t = useTranslations('bo')
  const router = useRouter()
  const [retiringId, setRetiringId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [, startRefresh] = useTransition()

  /** Re-reads the cargos from the server. */
  const refresh = () => startRefresh(() => router.refresh())

  const labelOf = (profile: StaffProfileItem) =>
    profile.role ? t(`role.${profile.role}`) : (profile.name ?? t('role.custom'))

  const peopleOf = (profile: StaffProfileItem) =>
    (people ?? []).filter(
      (person) =>
        person.status !== 'inactive' &&
        (profile.role ? person.role === profile.role : person.role === 'custom' && person.profileId === profile.id),
    )

  const retiring = profiles.find((profile) => profile.id === retiringId) ?? null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">
          {t('permissions.roles_heading')}
          <span className="ml-2 font-normal text-muted-foreground">{profiles.length}</span>
        </h2>
        {canManage && (
          <button type="button" onClick={() => setCreating(true)} className={primaryButtonClass}>
            <BoIcon name="plus" size={16} />
            {t('permissions.new_profile')}
          </button>
        )}
      </div>

      <Card as="section" className="overflow-hidden">
        <ul className="divide-y divide-line">
          {profiles.map((profile) => {
            const label = labelOf(profile)
            const holders = peopleOf(profile)
            return (
              <li key={profile.id} className="flex items-center justify-between gap-4 px-4 py-3 sm:px-5">
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-ink">{label}</h3>
                    {profile.role === null && (
                      <StatusBadge tone="neutral" dot={false} label={t('permissions.custom_badge')} />
                    )}
                    <span className="text-sm text-muted-foreground">
                      · {t('permissions.members', { count: profile.members })}
                    </span>
                  </div>
                  {holders.length > 0 && (
                      <ul className="flex flex-wrap gap-2">
                        {holders.map((person) => (
                          <li
                            key={person.id}
                            title={person.email}
                            className="inline-flex items-center gap-2 rounded-full border border-line bg-slate-50 py-1 pl-1 pr-3 text-sm text-ink"
                          >
                            <span
                              aria-hidden="true"
                              className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-blue/10 text-[11px] font-semibold text-brand-blue-deep"
                            >
                              {initials(person)}
                            </span>
                            {person.firstName} {person.lastName}
                            {person.status === 'invited' && (
                              <span className="text-xs text-amber-700">· {t('permissions.invited_badge')}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Hint label={t('permissions.edit_role')}>
                    <Link
                      href={`/backoffice/team/permissions/${profile.id}`}
                      aria-label={t('permissions.edit_role')}
                      className={`${iconButtonClass} border-line text-brand-blue hover:border-brand-blue/40 hover:bg-sky`}
                    >
                      <BoIcon name="edit" size={18} />
                    </Link>
                  </Hint>
                  {canManage && (
                    /* Shown on every cargo so the action is always where people
                       look for it; the board's cargos and the ones this account
                       cannot edit say why instead of disappearing. */
                    <Hint
                      label={
                        profile.role !== null
                            ? t('permissions.retire_system')
                            : !profile.editable
                              ? t('permissions.not_editable_note')
                              : t('permissions.retire')
                      }
                    >
                      <button
                        type="button"
                        onClick={() => setRetiringId(profile.id)}
                        disabled={profile.role !== null || !profile.editable}
                        aria-label={t('permissions.retire')}
                        className={`${iconButtonClass} border-red-200 text-red-600 hover:border-red-400 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-line disabled:text-slate-300 disabled:hover:bg-white`}
                      >
                        <BoIcon name="trash" size={18} />
                      </button>
                    </Hint>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </Card>

      {retiring && (
        <RetireDialog
          profile={retiring}
          label={labelOf(retiring)}
          onClose={() => setRetiringId(null)}
          onRetired={() => {
            setRetiringId(null)
            setToast(t('permissions.retired_toast'))
            refresh()
          }}
        />
      )}

      <NewProfileDialog
        open={creating}
        profiles={profiles}
        labelOf={labelOf}
        viewerPermissions={viewerPermissions}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false)
          router.push(`/backoffice/team/permissions/${id}`)
        }}
      />

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}

/**
 * The name of an icon-only action, shown at once on hover or focus. The span
 * carries the pointer events a disabled button swallows, so a greyed-out
 * delete still says why.
 */
function Hint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function initials(person: Pick<StaffMemberRow, 'firstName' | 'lastName'>): string {
  const first = (text: string) => text.match(/\p{L}/u)?.[0] ?? ''
  return `${first(person.firstName)}${first(person.lastName)}`.toUpperCase()
}

function NewProfileDialog({
  open,
  profiles,
  labelOf,
  viewerPermissions,
  onClose,
  onCreated,
}: {
  open: boolean
  profiles: StaffProfileItem[]
  labelOf: (profile: StaffProfileItem) => string
  viewerPermissions: readonly string[]
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const t = useTranslations('bo')
  const [name, setName] = useState('')
  const [copyFrom, setCopyFrom] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ErrorReason | null>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setCopyFrom('')
    setError(null)
  }, [open])

  async function create() {
    setPending(true)
    setError(null)
    const viewer = new Set(viewerPermissions)
    const source = profiles.find((profile) => profile.id === copyFrom)
    /* Starting from another cargo copies only what can be handed out, and only
       what the creator holds — the API refuses anything else. */
    const permissions = (source?.permissions ?? []).filter((key) => {
      const entry = ENTRIES.find((item) => item.key === key)
      return entry !== undefined && entry.grant === undefined && viewer.has(key)
    })
    const result = await send('/api/v1/staff/profiles', 'POST', { name, permissions })
    setPending(false)
    if (result.ok) onCreated((result.data as { id: string }).id)
    else setError(result.error)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('permissions.cancel')} className="bg-white">
        <DialogHeader className="gap-2 border-b border-line p-5 pr-14">
          <DialogTitle className="text-base font-semibold text-ink">{t('permissions.new_title')}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
          <div className="flex flex-col gap-4 p-5">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>{t('permissions.name_label')}</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={60}
                autoComplete="off"
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>{t('permissions.new_copy_from')}</span>
              <select value={copyFrom} onChange={(event) => setCopyFrom(event.target.value)} className={fieldClass}>
                <option value="">{t('permissions.new_copy_none')}</option>
                {profiles
                  .filter((profile) => !profile.locked)
                  .map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {labelOf(profile)}
                    </option>
                  ))}
              </select>
            </label>
            <p className="text-xs text-muted-foreground">{t('permissions.new_hint')}</p>
            {error && (
              <p role="alert" className="text-xs font-semibold text-red-600">
                {t(`permissions.error.${error}`)}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2 border-t border-line p-5 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} disabled={pending} className={secondaryButtonClass}>
              {t('permissions.cancel')}
            </button>
            <button type="submit" disabled={name.trim().length < 2 || pending} className={primaryButtonClass}>
              <BoIcon name={pending ? 'spinner' : 'plus'} size={16} className={pending ? 'animate-spin' : undefined} />
              {pending ? t('permissions.creating') : t('permissions.new_create')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

