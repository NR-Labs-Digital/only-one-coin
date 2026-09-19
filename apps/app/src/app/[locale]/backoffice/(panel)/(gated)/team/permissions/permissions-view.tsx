'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { StaffRole } from '@/lib/backoffice/types'
import type { CapabilityRow } from '@/lib/backoffice/role-permissions'
import {
  ALWAYS_ALLOWED_ROLES,
  type CapabilityGroup,
} from '@/lib/backoffice/capabilities'
import { Callout, Card, StatusBadge } from '@/components/backoffice/ui'
import { Toast, Toggle } from '@/components/backoffice/controls'
import { tabClass, tabStripClass } from '@/components/backoffice/tab-strip'
import { BoIcon, type BoIconName } from '@/components/backoffice/icons'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { restoreDefaultPermissions, setRolePermission } from './actions'

const GROUPS: readonly CapabilityGroup[] = [
  'operations',
  'academic',
  'administration',
]

/** One face per group, so a card is told apart before it is read. */
const groupIcon: Record<CapabilityGroup, BoIconName> = {
  operations: 'enrollments',
  academic: 'courses',
  administration: 'settings',
}

/**
 * What each cargo opens, one cargo at a time.
 *
 * A cargo per tab rather than the whole grid at once, and for two reasons.
 * The question people arrive with is about one cargo — "can the vendedor
 * register a student?" — and a seventeen-by-nine grid answers it by making
 * the reader count across a row. And a grid that wide on a phone is a table
 * that scrolls in both directions, which the panel does not do (CLAUDE.md §5).
 *
 * Nothing here is access control. It decides which doors the panel draws for a
 * cargo; whether a door actually opens is the role declared on the route in
 * `apps/api`, deny-by-default (CLAUDE.md §8).
 */
export function PermissionsView({
  rows,
  roles,
}: {
  rows: CapabilityRow[]
  roles: StaffRole[]
}) {
  const t = useTranslations('bo')
  const router = useRouter()

  /* Opening on `master` would open on the one tab where nothing can be moved.
     The first cargo that can be is where the work is. */
  const firstConfigurable =
    roles.find((role) => !ALWAYS_ALLOWED_ROLES.includes(role)) ?? roles[0]

  const [role, setRole] = useState<StaffRole>(firstConfigurable)
  const [state, setState] = useState<CapabilityRow[]>(rows)
  const [pending, setPending] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [confirmRestore, setConfirmRestore] = useState(false)

  /* The server is the source: after a write we refresh, and what comes back
     replaces what the click assumed. */
  useEffect(() => setState(rows), [rows])

  const fixed = ALWAYS_ALLOWED_ROLES.includes(role)

  const held = useMemo(
    () => state.filter((row) => row.roles.includes(role)).length,
    [state, role],
  )
  const customCount = useMemo(
    () => state.filter((row) => row.custom).length,
    [state],
  )

  const capabilityName = (key: string) => t(`permissions.capability.${key}`)

  async function toggle(row: CapabilityRow, allowed: boolean) {
    if (fixed || row.locked || pending) return
    setPending(row.key)

    try {
      const result = await setRolePermission(row.key, role, allowed)

      if (!result.ok) {
        setToast(t('permissions.write_failed'))
        return
      }

      const moved = new Set(result.moved)
      setState((current) =>
        current.map((item) =>
          moved.has(item.key)
            ? {
                ...item,
                custom: true,
                roles: allowed
                  ? [...new Set([...item.roles, role])]
                  : item.roles.filter((candidate) => candidate !== role),
              }
            : item,
        ),
      )

      /* What else went with the click, named. A dependency that moves in
         silence is the kind of thing somebody discovers a week later. */
      const alongside = result.moved
        .filter((key) => key !== row.key)
        .map(capabilityName)

      const headline = t(allowed ? 'permissions.granted_toast' : 'permissions.revoked_toast', {
        capability: capabilityName(row.key),
        role: t(`role.${role}`),
      })

      setToast(
        alongside.length > 0
          ? `${headline} ${t('permissions.alongside', { capabilities: alongside.join(', ') })}`
          : headline,
      )

      router.refresh()
    } catch {
      setToast(t('permissions.write_failed'))
    } finally {
      setPending(null)
    }
  }

  async function restore() {
    setConfirmRestore(false)
    setPending('restore')

    try {
      const result = await restoreDefaultPermissions()
      setToast(t(result.ok ? 'permissions.restored' : 'permissions.write_failed'))
      router.refresh()
    } catch {
      setToast(t('permissions.write_failed'))
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Callout tone="info" icon="shield">
        {t('permissions.intro')}
      </Callout>

      <nav className={tabStripClass} aria-label={t('permissions.roles_label')}>
        {roles.map((value) => {
          const active = value === role
          return (
            <button
              key={value}
              type="button"
              onClick={() => setRole(value)}
              aria-current={active ? 'page' : undefined}
              className={tabClass(active)}
            >
              {t(`role.${value}`)}
              {ALWAYS_ALLOWED_ROLES.includes(value) && (
                <BoIcon
                  name="shield"
                  size={13}
                  className={active ? 'text-brand-blue/60' : 'text-slate-400'}
                />
              )}
            </button>
          )
        })}
      </nav>

      <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-ink">{t(`role.${role}`)}</h2>
            <StatusBadge
              tone={fixed ? 'info' : 'neutral'}
              dot={false}
              label={t('permissions.held', { count: held, total: state.length })}
            />
            {customCount > 0 && (
              <StatusBadge
                tone="warning"
                label={t('permissions.custom_count', { count: customCount })}
              />
            )}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {fixed ? t('permissions.fixed_role') : t(`permissions.role_note.${role}`)}
          </p>
        </div>

        {customCount > 0 && (
          <button
            type="button"
            onClick={() => setConfirmRestore(true)}
            disabled={pending !== null}
            className="inline-flex min-h-tap shrink-0 items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:opacity-60"
          >
            <BoIcon name="sort" size={15} />
            {t('permissions.restore')}
          </button>
        )}
      </Card>

      {GROUPS.map((group) => {
        const items = state.filter((row) => row.group === group)
        if (items.length === 0) return null

        return (
          <Card key={group} className="overflow-hidden">
            <header className="flex items-center gap-2 border-b border-line bg-sky-soft px-4 py-3">
              <BoIcon name={groupIcon[group]} size={16} className="text-brand-blue" />
              <h3 className="text-sm font-semibold text-ink">
                {t(`permissions.group.${group}`)}
              </h3>
            </header>

            <ul>
              {items.map((row) => {
                const allowed = row.roles.includes(role)
                const locked = fixed || row.locked
                /* Who else holds it — what turns a switch into a review. */
                const others = row.roles
                  .filter((candidate) => candidate !== role)
                  .map((candidate) => t(`role.${candidate}`))

                return (
                  <li
                    key={row.key}
                    className="flex flex-col gap-1.5 border-b border-line/70 px-4 py-3.5 last:border-b-0"
                  >
                    <Toggle
                      checked={allowed}
                      disabled={locked || pending !== null}
                      onChange={(next) => void toggle(row, next)}
                      label={capabilityName(row.key)}
                      hint={t(`permissions.hint.${row.key}`)}
                    />

                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      {row.locked && (
                        <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                          <BoIcon name="shield" size={12} />
                          {t('permissions.locked_row')}
                        </span>
                      )}
                      {row.requires && (
                        <span>
                          {t('permissions.requires', {
                            capability: capabilityName(row.requires),
                          })}
                        </span>
                      )}
                      <span>
                        {others.length > 0
                          ? t('permissions.also_held', { roles: others.join(', ') })
                          : t('permissions.held_by_nobody_else')}
                      </span>
                      {row.custom && (
                        <span className="font-medium text-amber-700">
                          {t('permissions.changed_here')}
                        </span>
                      )}
                    </p>
                  </li>
                )
              })}
            </ul>
          </Card>
        )
      })}

      <Callout tone="warning" icon="alert">
        {t('permissions.provisional')}
      </Callout>

      <Dialog open={confirmRestore} onOpenChange={setConfirmRestore}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('permissions.restore_title')}</DialogTitle>
            <DialogDescription>
              {t('permissions.restore_body', { count: customCount })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setConfirmRestore(false)}
              className="inline-flex min-h-tap items-center justify-center rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
            >
              {t('permissions.restore_cancel')}
            </button>
            <button
              type="button"
              onClick={() => void restore()}
              className="inline-flex min-h-tap items-center justify-center rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-yellow hover:text-ink"
            >
              {t('permissions.restore_confirm')}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
