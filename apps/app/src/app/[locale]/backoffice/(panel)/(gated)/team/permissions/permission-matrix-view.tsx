'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  MFA_SENSITIVE_PERMISSIONS,
  PERMISSION_AREAS,
  PERMISSION_CATALOG,
  type PermissionArea,
  type PermissionGrant,
  type PermissionKey,
} from '@ooc/domain/permission-catalog'
import { groupByArea, profileHolds, type StaffProfileItem } from '@/lib/backoffice/permission-matrix'
import { Card, StatusBadge, TableShell, tdClass, thClass } from '@/components/backoffice/ui'
import { Toast } from '@/components/backoffice/controls'
import { HelpHint } from '@/components/backoffice/help-hint'
import { BoIcon } from '@/components/backoffice/icons'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const ALL = 'all'

type CatalogEntry = { key: PermissionKey; area: PermissionArea; grant?: PermissionGrant }

const ENTRIES = PERMISSION_CATALOG as readonly CatalogEntry[]
const GROUPS = groupByArea(ENTRIES, PERMISSION_AREAS)

const selectClass =
  'min-h-tap w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15 sm:w-auto'

const fieldClass =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

const labelClass = 'text-xs font-medium uppercase tracking-wide text-muted-foreground'

const primaryButtonClass =
  'inline-flex min-h-tap items-center justify-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-blue'

const secondaryButtonClass =
  'inline-flex min-h-tap items-center justify-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-60'

/* Ten cargos have to fit beside the action on a desktop: fixed layout shares
   what the action column leaves between them, and their names wrap in normal
   case instead of pushing columns behind the scroll. */
const roleHeadClass =
  'border-b border-line px-1 py-3 text-center align-bottom text-xs font-semibold leading-tight text-muted-foreground hyphens-auto [overflow-wrap:break-word]'

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

type ErrorReason = (typeof ERROR_REASONS)[number] | 'failed'

function errorOf(reason: string | undefined): ErrorReason {
  return (ERROR_REASONS as readonly string[]).includes(reason ?? '') ? (reason as ErrorReason) : 'failed'
}

async function send(url: string, method: 'POST' | 'PATCH', body?: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: ErrorReason }> {
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

/**
 * The cargos, two ways (OOC-57, OOC-183). All cargos side by side is the
 * comparison; one cargo at a time is the question people ask ("what does the
 * analyst see?"), the one that reads on a phone, and — for who holds
 * `team.profiles` — where a cargo's checkboxes are edited.
 */
export function PermissionMatrixView({
  profiles,
  viewerPermissions,
  canManage,
}: {
  profiles: StaffProfileItem[]
  viewerPermissions: readonly string[]
  canManage: boolean
}) {
  const t = useTranslations('bo')
  const router = useRouter()
  const [selected, setSelected] = useState<string>(ALL)
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [refreshing, startRefresh] = useTransition()

  /** Re-reads the cargos from the server; the selection waits for it. */
  const refresh = () => startRefresh(() => router.refresh())

  const labelOf = (profile: StaffProfileItem) =>
    profile.role ? t(`role.${profile.role}`) : (profile.name ?? t('role.custom'))

  /* A retired cargo leaves the list on refresh: fall back to the overview —
     but not while a refresh is bringing in the cargo just created. */
  const current = profiles.find((profile) => profile.id === selected) ?? null
  useEffect(() => {
    if (!refreshing && selected !== ALL && !current) setSelected(ALL)
  }, [refreshing, selected, current])

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-brand-blue">
            <BoIcon name="shield" size={18} />
          </span>
          <div className="flex flex-col gap-1.5 text-sm text-ink">
            <p>{t('permissions.intro')}</p>
            <p className="text-muted-foreground">{t('permissions.mfa_note')}</p>
            <p className="text-muted-foreground">{t('permissions.owners_note')}</p>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
            <span className="text-sm font-semibold text-ink">{t('permissions.role_filter')}</span>
            <select value={selected} onChange={(event) => setSelected(event.target.value)} className={selectClass}>
              <option value={ALL}>{t('permissions.all_roles')}</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {labelOf(profile)}
                </option>
              ))}
            </select>
          </label>
          {canManage && (
            <button type="button" onClick={() => setCreating(true)} className={primaryButtonClass}>
              <BoIcon name="plus" size={16} />
              {t('permissions.new_profile')}
            </button>
          )}
        </div>
      </Card>

      {current ? (
        <ProfileEditor
          key={current.id + current.permissions.join(',') + (current.name ?? '')}
          profile={current}
          label={labelOf(current)}
          viewerPermissions={viewerPermissions}
          canManage={canManage}
          onSaved={() => {
            setToast(t('permissions.saved_toast'))
            refresh()
          }}
          onRetired={() => {
            setSelected(ALL)
            setToast(t('permissions.retired_toast'))
            refresh()
          }}
        />
      ) : (
        GROUPS.map((group) => (
          <AreaTable key={group.area} area={group.area} entries={group.entries} profiles={profiles} labelOf={labelOf} />
        ))
      )}

      <NewProfileDialog
        open={creating}
        profiles={profiles}
        labelOf={labelOf}
        viewerPermissions={viewerPermissions}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false)
          setSelected(id)
          setToast(t('permissions.created_toast'))
          refresh()
        }}
      />

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}

function AreaTable({
  area,
  entries,
  profiles,
  labelOf,
}: {
  area: PermissionArea
  entries: CatalogEntry[]
  profiles: StaffProfileItem[]
  labelOf: (profile: StaffProfileItem) => string
}) {
  const t = useTranslations('bo')
  const columns = [t('permissions.col_action'), ...profiles.map(labelOf)]

  return (
    <Card as="section">
      <h2 className="border-b border-line px-4 py-3 text-base font-semibold text-ink">
        {t(`permissions.area.${area}`)}
      </h2>
      <TableShell columns={columns} fixed>
        <colgroup>
          <col className="w-48" />
          {profiles.map((profile) => (
            <col key={profile.id} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className={thClass}>{columns[0]}</th>
            {profiles.map((profile) => (
              <th key={profile.id} className={roleHeadClass}>
                {labelOf(profile)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.key}>
              <td className={tdClass}>
                <ActionLabel entry={entry} />
              </td>
              {profiles.map((profile) => (
                <td key={profile.id} className={`${tdClass} px-1.5 text-center`}>
                  <Mark allowed={profileHolds(profile, entry.key)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </TableShell>
    </Card>
  )
}

/** Why a box cannot be ticked here, or null when it can. */
function lockReason(entry: CatalogEntry, viewer: ReadonlySet<string>): string | null {
  if (entry.grant === 'teacher') return 'permissions.grant_teacher'
  if (entry.grant === 'owners') return 'permissions.grant_owners'
  if (entry.grant === 'everyone') return 'permissions.grant_everyone'
  if (!viewer.has(entry.key)) return 'permissions.not_held'
  return null
}

function ProfileEditor({
  profile,
  label,
  viewerPermissions,
  canManage,
  onSaved,
  onRetired,
}: {
  profile: StaffProfileItem
  label: string
  viewerPermissions: readonly string[]
  canManage: boolean
  onSaved: () => void
  onRetired: () => void
}) {
  const t = useTranslations('bo')
  const viewer = useMemo(() => new Set(viewerPermissions), [viewerPermissions])
  const [checked, setChecked] = useState<Set<string>>(() => new Set(profile.permissions))
  const [name, setName] = useState(profile.name ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ErrorReason | null>(null)
  const [confirmingRetire, setConfirmingRetire] = useState(false)

  const editable = profile.editable
  const dirty =
    name.trim() !== (profile.name ?? '') ||
    checked.size !== profile.permissions.length ||
    profile.permissions.some((key) => !checked.has(key))
  const count = ENTRIES.filter((entry) => checked.has(entry.key)).length
  const willRequireMfa = MFA_SENSITIVE_PERMISSIONS.some((key) => checked.has(key))

  function toggle(key: string) {
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function save() {
    setPending(true)
    setError(null)
    const result = await send(`/api/v1/staff/profiles/${profile.id}`, 'PATCH', {
      ...(profile.role === null ? { name } : {}),
      permissions: [...checked],
    })
    setPending(false)
    if (result.ok) onSaved()
    else setError(result.error)
  }

  async function retire() {
    setPending(true)
    setError(null)
    const result = await send(`/api/v1/staff/profiles/${profile.id}/retire`, 'POST')
    setPending(false)
    setConfirmingRetire(false)
    if (result.ok) onRetired()
    else setError(result.error)
  }

  const note = profile.locked
    ? 'permissions.locked_note'
    : !canManage
      ? 'permissions.readonly_note'
      : !editable
        ? 'permissions.not_editable_note'
        : null

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-ink">{label}</h2>
          {profile.role === null && <StatusBadge tone="neutral" dot={false} label={t('permissions.custom_badge')} />}
          <StatusBadge tone="info" dot={false} label={t('permissions.count', { count, total: ENTRIES.length })} />
          <StatusBadge tone="neutral" dot={false} label={t('permissions.members', { count: profile.members })} />
          {(editable ? willRequireMfa || profile.mfaRequired : profile.mfaRequired) && (
            <StatusBadge tone="warning" dot={false} label={t('permissions.mfa_required')} />
          )}
          <HelpHint what={t('help.admin_perm_badges_what')} how={t('help.admin_perm_badges_how')} />
        </div>
        {note && <p className="text-sm text-muted-foreground">{t(note)}</p>}
        {editable && profile.role === null && (
          <label className="flex max-w-md flex-col gap-1">
            <span className={labelClass}>{t('permissions.name_label')}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} className={fieldClass} />
          </label>
        )}
        {editable && willRequireMfa && !profile.mfaRequired && (
          <p className="text-sm font-medium text-amber-700">{t('permissions.mfa_will_require')}</p>
        )}
      </Card>

      {GROUPS.map((group) => (
        <Card as="section" key={group.area}>
          <h3 className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">
            {t(`permissions.area.${group.area}`)}
          </h3>
          <ul>
            {group.entries.map((entry) => {
              const allowed = checked.has(entry.key)
              const reason = editable ? lockReason(entry, viewer) : null
              return (
                <li
                  key={entry.key}
                  className={`flex items-start justify-between gap-3 border-b border-line/70 px-4 last:border-b-0 ${editable ? 'py-0.5' : 'py-3'}`}
                >
                  {editable ? (
                    <label className={`flex min-h-tap flex-1 items-center gap-3 py-1.5 ${reason ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                      <input
                        type="checkbox"
                        checked={allowed}
                        disabled={reason !== null || pending}
                        onChange={() => toggle(entry.key)}
                        className="h-4 w-4 shrink-0 accent-brand-blue"
                      />
                      <span className="flex flex-col gap-0.5 text-sm">
                        <ActionLabel entry={entry} />
                        {reason && <span className="text-xs text-muted-foreground">{t(reason)}</span>}
                      </span>
                    </label>
                  ) : (
                    <>
                      <div className={`text-sm ${allowed ? 'text-ink' : 'text-muted-foreground'}`}>
                        <ActionLabel entry={entry} />
                      </div>
                      <StatusBadge
                        tone={allowed ? 'success' : 'neutral'}
                        label={allowed ? t('permissions.allowed') : t('permissions.denied')}
                      />
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </Card>
      ))}

      {editable && (
        <Card className="sticky bottom-3 flex flex-col gap-3 p-4 pb-safe-b sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            {error ? (
              <p role="alert" className="font-semibold text-red-600">
                {t(`permissions.error.${error}`)}
              </p>
            ) : (
              <p className="text-muted-foreground">{dirty ? t('permissions.unsaved') : t('permissions.saved_state')}</p>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <button type="button" onClick={() => void save()} disabled={!dirty || pending} className={primaryButtonClass}>
              <BoIcon name={pending ? 'spinner' : 'check'} size={16} className={pending ? 'animate-spin' : undefined} />
              {pending ? t('permissions.saving') : t('permissions.save')}
            </button>
            {dirty && (
              <button
                type="button"
                onClick={() => {
                  setChecked(new Set(profile.permissions))
                  setName(profile.name ?? '')
                  setError(null)
                }}
                disabled={pending}
                className={secondaryButtonClass}
              >
                {t('permissions.discard')}
              </button>
            )}
            {profile.role === null && (
              <button
                type="button"
                onClick={() => setConfirmingRetire(true)}
                disabled={pending}
                className="inline-flex min-h-tap items-center justify-center gap-1.5 rounded-lg border border-red-200 px-3.5 py-2 text-sm font-semibold text-red-600 transition hover:border-red-400 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <BoIcon name="trash" size={16} />
                {t('permissions.retire')}
              </button>
            )}
          </div>
        </Card>
      )}

      <Dialog open={confirmingRetire} onOpenChange={(next) => !next && setConfirmingRetire(false)}>
        <DialogContent closeLabel={t('permissions.cancel')} className="bg-white">
          <DialogHeader className="gap-2 border-b border-line p-5 pr-14">
            <DialogTitle className="text-base font-semibold text-ink">{t('permissions.retire_title')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 p-5 text-sm text-ink">
            <p>{profile.members > 0 ? t('permissions.retire_in_use', { count: profile.members }) : t('permissions.retire_body', { name: label })}</p>
          </div>
          <div className="flex flex-col gap-2 border-t border-line p-5 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setConfirmingRetire(false)} className={secondaryButtonClass}>
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
    </div>
  )
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

function ActionLabel({ entry }: { entry: CatalogEntry }) {
  const t = useTranslations('bo')
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>{t(`permissions.capability.${entry.key}`)}</span>
      {entry.grant === 'owners' && <StatusBadge tone="info" dot={false} label={t('permissions.owners_only')} />}
    </span>
  )
}

function Mark({ allowed }: { allowed: boolean }) {
  const t = useTranslations('bo')
  return allowed ? (
    <span className="inline-flex items-center justify-center text-emerald-600">
      <BoIcon name="check" size={18} />
      <span className="sr-only">{t('permissions.allowed')}</span>
    </span>
  ) : (
    <span className="inline-flex items-center justify-center text-slate-300">
      <span aria-hidden="true" className="inline-block h-0.5 w-3 rounded bg-current" />
      <span className="sr-only">{t('permissions.denied')}</span>
    </span>
  )
}
