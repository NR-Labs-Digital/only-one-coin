'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { MFA_SENSITIVE_PERMISSIONS, PERMISSION_ACCESS, type PermissionAccess, type PermissionArea } from '@ooc/domain/permission-catalog'
import { useRouter } from '@/i18n/navigation'
import { accessLevel, withAreaAccess, type AccessLevel, type StaffProfileItem } from '@/lib/backoffice/permission-matrix'
import { HelpHint } from '@/components/backoffice/help-hint'
import { Card, StatusBadge } from '@/components/backoffice/ui'
import { Toast } from '@/components/backoffice/controls'
import { BoIcon } from '@/components/backoffice/icons'
import {
  ActionLabel,
  GROUPS,
  type CatalogEntry,
  Mark,
  RetireDialog,
  Switch,
  dangerButtonClass,
  fieldClass,
  labelClass,
  lockReason,
  primaryButtonClass,
  secondaryButtonClass,
  send,
  type ErrorReason,
} from '../permission-shared'

/**
 * A cargo's page: its name (only a cargo created in Equipo has one to edit),
 * a switch per permission grouped by area, and — for every cargo but master
 * and teacher — deleting it. The save bar shows up only once something changed.
 */
export function RoleEditor({
  profile,
  viewerPermissions,
  canManage,
}: {
  profile: StaffProfileItem
  viewerPermissions: readonly string[]
  canManage: boolean
}) {
  const t = useTranslations('bo')
  const router = useRouter()
  const viewer = useMemo(() => new Set(viewerPermissions), [viewerPermissions])
  const [checked, setChecked] = useState<Set<string>>(() => new Set(profile.permissions))
  const [name, setName] = useState(profile.name ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ErrorReason | null>(null)
  const [retiring, setRetiring] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const label = profile.role ? t(`role.${profile.role}`) : (profile.name ?? t('role.custom'))
  const editable = profile.editable
  const dirty =
    name.trim() !== (profile.name ?? '') ||
    checked.size !== profile.permissions.length ||
    profile.permissions.some((key) => !checked.has(key))
  const willRequireMfa = MFA_SENSITIVE_PERMISSIONS.some((key) => checked.has(key))

  async function save() {
    setPending(true)
    setError(null)
    const result = await send(`/api/v1/staff/profiles/${profile.id}`, 'PATCH', {
      ...(profile.role === null ? { name } : {}),
      permissions: [...checked],
    })
    setPending(false)
    if (result.ok) {
      setToast(t('permissions.saved_toast'))
      router.refresh()
    } else setError(result.error)
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
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{label}</h1>
            {profile.role === null && <StatusBadge tone="neutral" dot={false} label={t('permissions.custom_badge')} />}
          </div>
          <p className="text-sm text-muted-foreground">{t('permissions.members', { count: profile.members })}</p>
        </div>
        {/* Every cargo but master and teacher (never editable) can go once
            nobody is on it; with people on it the button says why. */}
        {editable && (
          <button
            type="button"
            onClick={() => setRetiring(true)}
            disabled={profile.members > 0}
            title={profile.members > 0 ? t('permissions.retire_in_use_hint', { count: profile.members }) : undefined}
            className={dangerButtonClass}
          >
            <BoIcon name="trash" size={16} />
            {t('permissions.retire')}
          </button>
        )}
      </header>

      {note && (
        <p className="rounded-lg border border-line bg-white px-4 py-3 text-sm text-muted-foreground">{t(note)}</p>
      )}

      {editable && profile.role === null && (
        <Card className="p-4 sm:p-5">
          <label className="flex max-w-md flex-col gap-1">
            <span className={labelClass}>{t('permissions.name_label')}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} className={fieldClass} />
          </label>
        </Card>
      )}

      {editable && willRequireMfa && !profile.mfaRequired && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          {t('permissions.mfa_will_require')}
        </p>
      )}

      {/* Each area answers two questions first — can the cargo see it, can
          it change it (OOC-192) — and keeps its actions one tap away, for
          the cargo that needs some of a side and not all of it. */}
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {t('permissions.access_intro')}
        <HelpHint what={t('help.permission_access_what')} how={t('help.permission_access_how')} />
      </p>
      <div className="columns-1 gap-4 @3xl/page:columns-2 @6xl/page:columns-3">
        {GROUPS.map((group) => (
          <AreaCard
            key={group.area}
            area={group.area}
            entries={group.entries}
            checked={checked}
            editable={editable}
            pending={pending}
            viewer={viewer}
            onChange={setChecked}
          />
        ))}
      </div>

      {editable && (dirty || error) && (
        <div className="sticky bottom-3 z-30 flex flex-col gap-3 rounded-xl border border-brand-blue/30 bg-white p-3 pb-safe-b shadow-lg sm:flex-row sm:items-center sm:justify-between sm:pl-4">
          <div className="text-sm">
            {error ? (
              <p role="alert" className="font-semibold text-red-600">
                {t(`permissions.error.${error}`)}
              </p>
            ) : (
              <p className="font-medium text-ink">{t('permissions.unsaved')}</p>
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
          </div>
        </div>
      )}

      {retiring && (
        <RetireDialog
          profile={profile}
          label={label}
          onClose={() => setRetiring(false)}
          onRetired={() => {
            router.push('/backoffice/team/permissions')
            router.refresh()
          }}
        />
      )}

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}

/**
 * One area of the panel: a "see" and a "change" switch (OOC-192), half-filled
 * when the cargo holds only part of that side, and the area's actions under
 * them — folded away unless the cargo already holds a part of a side, which is
 * what someone opening it needs to see.
 */
function AreaCard({
  area,
  entries,
  checked,
  editable,
  pending,
  viewer,
  onChange,
}: {
  area: PermissionArea
  entries: CatalogEntry[]
  checked: ReadonlySet<string>
  editable: boolean
  pending: boolean
  viewer: ReadonlySet<string>
  onChange: (next: Set<string>) => void
}) {
  const t = useTranslations('bo')
  const canFlip = (entry: CatalogEntry) => lockReason(entry, viewer) === null
  const levels = PERMISSION_ACCESS.map((access) => ({ access, level: accessLevel(entries, checked, access) }))
  const [open, setOpen] = useState(() => levels.some(({ level }) => level === 'some'))
  const held = entries.filter((entry) => checked.has(entry.key)).length

  function flipSide(access: PermissionAccess, level: AccessLevel) {
    onChange(withAreaAccess(checked, entries, access, level !== 'all', canFlip))
  }

  function flipOne(key: string) {
    const next = new Set(checked)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(next)
  }

  return (
    <Card as="section" className="mb-4 break-inside-avoid overflow-hidden">
      <h2 className="border-b border-line bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
        {t(`permissions.area.${area}`)}
      </h2>
      <div className="flex flex-wrap gap-x-5 gap-y-2 border-b border-line px-3 py-2.5">
        {levels.map(({ access, level }) => {
          if (level === null) return null
          const name = t(`permissions.access.${access}`)
          const state = level === 'some' ? t('permissions.access_partly') : null
          const flippable = entries.some((entry) => entry.access === access && canFlip(entry))
          return editable ? (
            <label
              key={access}
              className={`flex items-center gap-2 text-sm font-semibold ${flippable ? 'cursor-pointer text-ink' : 'cursor-not-allowed text-muted-foreground opacity-60'}`}
            >
              <Switch
                checked={level !== 'none'}
                mixed={level === 'some'}
                disabled={!flippable || pending}
                onChange={() => flipSide(access, level)}
              />
              <span>
                {name}
                {state && <span className="ml-1 font-normal text-muted-foreground">({state})</span>}
              </span>
            </label>
          ) : (
            <div key={access} className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Mark allowed={level !== 'none'} />
              <span>
                {name}
                {state && <span className="ml-1 font-normal text-muted-foreground">({state})</span>}
              </span>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex min-h-tap w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs font-medium text-muted-foreground transition hover:bg-slate-50 hover:text-ink"
      >
        <span>{t('permissions.access_detail', { count: held, total: entries.length })}</span>
        <BoIcon name="chevron-down" size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul className="border-t border-line py-1">
          {entries.map((entry) => {
            const allowed = checked.has(entry.key)
            const reason = editable ? lockReason(entry, viewer) : null
            return (
              <li key={entry.key}>
                {editable ? (
                  <label
                    title={reason ? t(reason) : undefined}
                    className={`flex items-start gap-2.5 px-3 py-1.5 text-sm leading-snug transition ${
                      reason ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-slate-50'
                    }`}
                  >
                    <Switch checked={allowed} disabled={reason !== null || pending} onChange={() => flipOne(entry.key)} />
                    <span className={allowed ? 'text-ink' : 'text-muted-foreground'}>
                      <ActionLabel entry={entry} />
                    </span>
                  </label>
                ) : (
                  <div className="flex items-start gap-2.5 px-3 py-1.5 text-sm leading-snug">
                    <Mark allowed={allowed} />
                    <span className={allowed ? 'text-ink' : 'text-muted-foreground'}>
                      <ActionLabel entry={entry} />
                    </span>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
