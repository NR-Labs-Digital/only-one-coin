'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, getPathname } from '@/i18n/navigation'
import type { StaffMemberRow, StaffRole } from '@/lib/backoffice/types'
import { buildInvitePath, isInviteExpired } from '@/lib/backoffice/invite'
import { formatDate, formatDateTime, initials, type Locale } from '@/lib/format'
import {
  Card,
  EmptyState,
  Pager,
  rowActionClass,
  StatusBadge,
  TableShell,
  tdClass,
  thClass,
  Toolbar,
  toolbarSearchClass,
} from '@/components/backoffice/ui'
import { Toast } from '@/components/backoffice/controls'
import { BoIcon } from '@/components/backoffice/icons'
import { tabClass, tabStripClass } from '@/components/backoffice/tab-strip'
import { FiltersDropdown } from '@/components/backoffice/filters-dropdown'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { NewStaffForm, type TeacherOption } from './new-staff-form'
import { RoleChangeDialog } from './role-change-dialog'

/**
 * Accounts that still open the panel, accounts with an invite still waiting
 * on the person, and accounts that used to open it. Three tabs rather than a
 * status filter, for the same reason the teacher roster has two: "who can
 * sign in tomorrow", "who was asked to and hasn't yet", and "who used to" are
 * three different questions, and the first is asked far more often than the
 * other two.
 */
type Tab = 'active' | 'invited' | 'inactive'

const ALL = 'all'

const PAGE_SIZE = 15

/** Every cargo an account can carry (owner's map — `lib/backoffice/permissions.ts`). */
const ROLES: StaffRole[] = [
  'master',
  'admin',
  'analyst',
  'enrollment_supervisor',
  'academic_supervisor',
  'teacher',
  'sales',
  'support',
  'billing',
]

const selectClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

/**
 * Team directory. Search, filters and paging run in the browser because the
 * dataset is mocked; against the real API this becomes a server query.
 *
 * Every write here is component state. The real ones are usecases in
 * `apps/api`: opening an account, and the dedicated promotion usecase that is
 * the only way a `role` ever moves — admin-only, behind fresh
 * re-authentication, and written to the append-only audit log in the same
 * transaction (CLAUDE.md §8). The browser never writes a cargo.
 */
export function TeamView({
  rows,
  teachers,
  currentUserId,
  currentUserName,
}: {
  rows: StaffMemberRow[]
  /** Teachers still on the roster — who an account may be opened over. */
  teachers: TeacherOption[]
  /** The signed-in admin: nobody moves their own cargo or their own door. */
  currentUserId: string
  currentUserName: string
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  const [members, setMembers] = useState<StaffMemberRow[]>(rows)
  const [tab, setTab] = useState<Tab>('active')
  const [query, setQuery] = useState('')
  const [role, setRole] = useState(ALL)
  const [page, setPage] = useState(0)
  const [creating, setCreating] = useState(false)
  const [changing, setChanging] = useState<StaffMemberRow | null>(null)
  const [removing, setRemoving] = useState<StaffMemberRow | null>(null)
  const [cancelling, setCancelling] = useState<StaffMemberRow | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [resetLink, setResetLink] = useState<{ name: string; link: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  /** The tab is the first cut; every filter and count below reads this list. */
  const scoped = useMemo(
    () => members.filter((row) => row.status === tab),
    [members, tab],
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return scoped.filter((row) => {
      if (role !== ALL && row.role !== role) return false
      if (!needle) return true
      return [`${row.firstName} ${row.lastName}`, row.email, t(`role.${row.role}`)]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
  }, [scoped, query, role, t])

  const counts = useMemo(
    () => ({
      active: members.filter((row) => row.status === 'active').length,
      invited: members.filter((row) => row.status === 'invited').length,
      inactive: members.filter((row) => row.status === 'inactive').length,
    }),
    [members],
  )

  /* Only teachers who do not already hold an account: two doors for one person
     is two sessions to remember to close. Computed here rather than on the
     server so an account opened a second ago already counts. */
  const availableTeachers = useMemo(
    () =>
      teachers.filter(
        (teacher) => !members.some((row) => row.teacherId === teacher.id),
      ),
    [teachers, members],
  )

  const onActive = tab === 'active'

  const activeFilters = role !== ALL ? 1 : 0

  /** A filter that shrinks the list can leave the page behind it. */
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(
    currentPage * PAGE_SIZE,
    currentPage * PAGE_SIZE + PAGE_SIZE,
  )

  function openTab(next: Tab) {
    setTab(next)
    setPage(0)
  }

  /**
   * The cargo moved. `PromoteStaffRoleRoute` writes the `role` column and the
   * `audit_log` entry in one call (CLAUDE.md §8) — this only applies the same
   * change to the row already on screen once the server confirms it.
   * Returns whether it succeeded so the dialog knows whether to stay open
   * (e.g. wrong re-auth password) or close.
   */
  async function applyRoleChange(
    member: StaffMemberRow,
    next: StaffRole,
    password: string,
  ): Promise<boolean> {
    const response = await fetch(`/api/v1/staff/${member.id}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: next, password }),
    })
    if (!response.ok) return false

    setMembers((current) =>
      current.map((row) => (row.id === member.id ? { ...row, role: next } : row)),
    )
    setChanging(null)
    setToast(t('team.changed_toast'))
    return true
  }

  function applyAccessLocal(member: StaffMemberRow, status: StaffMemberRow['status']) {
    setMembers((current) =>
      current.map((row) => (row.id === member.id ? { ...row, status } : row)),
    )
    setToast(t(status === 'active' ? 'team.restored_toast' : 'team.removed_toast'))
  }

  async function removeAccess(member: StaffMemberRow) {
    const response = await fetch(`/api/v1/staff/${member.id}/access/remove`, { method: 'POST' })
    setRemoving(null)
    if (!response.ok) {
      setToast(t('team.action_failed'))
      return
    }
    applyAccessLocal(member, 'inactive')
  }

  async function restoreAccess(member: StaffMemberRow) {
    if (busyId) return
    setBusyId(member.id)
    try {
      const response = await fetch(`/api/v1/staff/${member.id}/access/restore`, { method: 'POST' })
      if (!response.ok) {
        setToast(t('team.action_failed'))
        return
      }
      applyAccessLocal(member, 'active')
    } finally {
      setBusyId(null)
    }
  }

  /** Withdrawing the invite before the person ever completed it. The link
      itself keeps failing on its own once the row moves off `invited` — the
      completion screen only resolves a token still marked pending. */
  async function cancelInvite(member: StaffMemberRow) {
    const response = await fetch(`/api/v1/staff/invites/${member.id}/cancel`, { method: 'POST' })
    setCancelling(null)
    if (!response.ok) {
      setToast(t('team.action_failed'))
      return
    }
    setMembers((current) =>
      current.map((row) =>
        row.id === member.id ? { ...row, status: 'inactive', inviteToken: null } : row,
      ),
    )
    setToast(t('team.cancel_invite_toast'))
  }

  /** Same token, new expiry — the invite screen's "copiar el enlace" stays
      valid for the same link either way (CLAUDE.md decision on
      staff_invites.token, packages/db/src/schema.ts). */
  async function renewInvite(member: StaffMemberRow) {
    if (busyId) return
    setBusyId(member.id)
    try {
      const response = await fetch(`/api/v1/staff/invites/${member.id}/renew`, { method: 'POST' })
      if (!response.ok) {
        setToast(t('team.action_failed'))
        return
      }
      const result = (await response.json()) as { token: string; expiresAt: string }
      setMembers((current) =>
        current.map((row) =>
          row.id === member.id ? { ...row, inviteExpiresAt: result.expiresAt } : row,
        ),
      )
      setToast(t('team.renewed_toast'))
    } finally {
      setBusyId(null)
    }
  }

  async function copyInviteLink(member: StaffMemberRow) {
    if (!member.inviteToken) return
    const path = getPathname({ href: buildInvitePath(member.inviteToken), locale })
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    try {
      await navigator.clipboard.writeText(`${origin}${path}`)
      setCopiedId(member.id)
      window.setTimeout(() => setCopiedId((current) => (current === member.id ? null : current)), 2000)
    } catch {
      // Clipboard permission denied or unavailable — nothing to fall back to
      // from a table row; the invite dialog keeps the link in a field too.
    }
  }

  /** A one-time, 24h link to set a new password on an account that already
      exists — the same copy-and-send shape as an invite, for the same
      reason: nobody but the account owner ever holds the password
      (CLAUDE.md §8). */
  async function createPasswordReset(member: StaffMemberRow) {
    if (busyId) return
    setBusyId(member.id)
    try {
      const response = await fetch(`/api/v1/staff/${member.id}/password-reset`, { method: 'POST' })
      if (!response.ok) {
        setToast(t('team.action_failed'))
        return
      }
      const result = (await response.json()) as { token: string; expiresAt: string }
      const path = getPathname({ href: `/backoffice/reset-password/${result.token}`, locale })
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      setResetLink({ name: `${member.firstName} ${member.lastName}`, link: `${origin}${path}` })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Not `SectionTabs`: those are real routes, and these three are one
          list cut three ways — the same page, the same filters, no URL to
          bookmark. */}
      <nav className={tabStripClass}>
        {(['active', 'invited', 'inactive'] as Tab[]).map((value) => {
          const active = tab === value
          const label =
            value === 'active'
              ? 'team.tab_active'
              : value === 'invited'
                ? 'team.tab_invited'
                : 'team.tab_inactive'
          return (
            <button
              key={value}
              type="button"
              onClick={() => openTab(value)}
              aria-current={active ? 'page' : undefined}
              className={tabClass(active)}
            >
              {t(label)}
              <span className={active ? 'text-brand-blue/60' : 'text-slate-400'}>
                {counts[value]}
              </span>
            </button>
          )
        })}
      </nav>

      {/* Toolbar */}
      <div className="flex flex-col gap-3">
        <Toolbar>
          <label className={toolbarSearchClass}>
            <span className="sr-only">{t('team.search_label')}</span>
            <BoIcon
              name="search"
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(0)
              }}
              placeholder={t('team.search_placeholder')}
              // Off, deliberately: a role-change dialog elsewhere on this
              // screen has a lone password field with nothing to pair it
              // with, and without this the browser's autofill went looking
              // for a "username" and landed the admin's own saved e-mail
              // here — which then filtered the whole directory down to just
              // the admin (role-change-dialog.tsx carries the other half of
              // the fix, a <form> boundary around that field).
              autoComplete="off"
              className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
            />
          </label>

          <FiltersDropdown
            label={t('team.filters')}
            count={activeFilters}
            panelClassName="flex-wrap items-center gap-1.5"
          >
            <label className="flex items-center gap-2">
              <span className="sr-only">{t('team.filter_role')}</span>
              <select
                value={role}
                onChange={(event) => {
                  setRole(event.target.value)
                  setPage(0)
                }}
                className={selectClass}
              >
                <option value={ALL}>{t('team.filter_role')}</option>
                {ROLES.map((item) => (
                  <option key={item} value={item}>
                    {t(`role.${item}`)}
                  </option>
                ))}
              </select>
            </label>
          </FiltersDropdown>

          {!creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep lg:ml-auto"
            >
              <BoIcon name="plus" size={16} />
              {t('team.new')}
            </button>
          )}
        </Toolbar>

      </div>

      {creating && (
        <NewStaffForm
          teachers={availableTeachers}
          onCancel={() => setCreating(false)}
          onCreate={(member) => {
            setMembers((current) => [member, ...current])
            setCreating(false)
            setTab('invited')
            setPage(0)
            setToast(t('team.created_toast'))
          }}
        />
      )}

      <Card>
        {pageRows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={scoped.length === 0 ? 'staff' : 'search'}
              title={t(
                scoped.length > 0
                  ? 'team.empty_title'
                  : tab === 'inactive'
                    ? 'team.empty_inactive_title'
                    : tab === 'invited'
                      ? 'team.empty_invited_title'
                      : 'team.empty_title',
              )}
              body={t(
                scoped.length > 0
                  ? 'team.empty_body'
                  : tab === 'inactive'
                    ? 'team.empty_inactive_body'
                    : tab === 'invited'
                      ? 'team.empty_invited_body'
                      : 'team.empty_body',
              )}
            />
          </div>
        ) : (
          <>
            <TableShell
              columns={[
                t('team.col_member'),
                t('team.col_role'),
                t('team.col_last_access'),
                t('common.actions'),
              ]}
            >
              <thead>
                <tr>
                  <th className={thClass}>{t('team.col_member')}</th>
                  <th className={thClass}>{t('team.col_role')}</th>
                  <th className={thClass}>{t('team.col_last_access')}</th>
                  {/* Off the active tab the row still ends in an action: giving
                      a door back is done from the same line it was taken. */}
                  <th className={`${thClass} text-right`}>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const self = row.id === currentUserId
                  /* The docente cargo travels with the roster file: an account
                     is opened over a teacher record, so moving somebody into or
                     out of it here would leave the link pointing nowhere. */
                  const lockedByRoster = row.role === 'teacher'
                  return (
                    <tr key={row.id}>
                      <td className={`${tdClass} whitespace-nowrap`}>
                        <span className="flex items-center gap-2.5">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sky text-xs font-semibold text-brand-blue-deep">
                            {initials(row.firstName, row.lastName)}
                          </span>
                          <span className="flex min-w-0 flex-col leading-tight">
                            <span className="flex items-center gap-1.5">
                              <span className="font-semibold text-ink">
                                {`${row.firstName} ${row.lastName}`}
                              </span>
                              {self && (
                                <span className="rounded-full bg-cream px-1.5 py-0.5 text-[11px] font-semibold text-brand-yellow-deep">
                                  {t('team.you')}
                                </span>
                              )}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {row.email}
                            </span>
                            {/* The account of a docente is the roster file seen
                                from the door side — the two are one person, and
                                the panel says so instead of making somebody
                                search the other section for them. */}
                            {row.teacherId && (
                              <Link
                                href={`/backoffice/teachers/${row.teacherId}`}
                                className="mt-0.5 inline-flex w-fit items-center gap-1 text-xs font-semibold text-brand-blue transition hover:text-brand-blue-deep"
                              >
                                <BoIcon name="chevron-right" size={12} />
                                {t('team.teacher_file')}
                              </Link>
                            )}
                          </span>
                        </span>
                      </td>

                      {/* The cargo, and only the cargo: the tab above already
                          said whether the door is open, and a badge that reads
                          the same on every row of a list says nothing. */}
                      <td className={`${tdClass} whitespace-nowrap`}>
                        <span className="rounded-full bg-sky px-2 py-0.5 text-[11px] font-semibold text-brand-blue-deep">
                          {t(`role.${row.role}`)}
                        </span>
                      </td>

                      <td className={`${tdClass} whitespace-nowrap text-xs`}>
                        {row.status === 'invited' ? (
                          <span className="flex flex-col">
                            <span className="text-muted-foreground">
                              {t('team.invite_sent', { date: formatDate(row.joinedAt, locale) })}
                            </span>
                            {isInviteExpired(row.inviteExpiresAt) ? (
                              <span className="font-semibold text-red-600">
                                {t('team.invite_expired')}
                              </span>
                            ) : (
                              row.inviteExpiresAt && (
                                <span className="text-muted-foreground">
                                  {t('team.invite_expires', {
                                    date: formatDate(row.inviteExpiresAt, locale),
                                  })}
                                </span>
                              )
                            )}
                          </span>
                        ) : row.lastAccessAt ? (
                          <span className="text-muted-foreground">
                            {formatDateTime(row.lastAccessAt, locale)}
                          </span>
                        ) : (
                          <span className="font-semibold text-amber-700">
                            {t('team.never_accessed')}
                          </span>
                        )}
                      </td>

                      <td className={`${tdClass} whitespace-nowrap text-right`}>
                        {self ? (
                          <span
                            className="text-xs text-muted-foreground"
                            title={t('team.self_title')}
                          >
                            {t('team.self_note')}
                          </span>
                        ) : row.status === 'invited' ? (
                          <span className="inline-flex flex-wrap items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => copyInviteLink(row)}
                              className={rowActionClass}
                            >
                              <BoIcon name={copiedId === row.id ? 'check' : 'link'} size={14} />
                              {t(copiedId === row.id ? 'team.invite_copied' : 'team.invite_copy')}
                            </button>
                            {isInviteExpired(row.inviteExpiresAt) && (
                              <button
                                type="button"
                                onClick={() => renewInvite(row)}
                                disabled={busyId === row.id}
                                className={`${rowActionClass} disabled:cursor-not-allowed disabled:opacity-60`}
                              >
                                <BoIcon
                                  name={busyId === row.id ? 'spinner' : 'clock'}
                                  size={14}
                                  className={busyId === row.id ? 'animate-spin' : undefined}
                                />
                                {t('team.renew_invite')}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setCancelling(row)}
                              disabled={busyId === row.id}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm font-semibold text-muted-foreground transition hover:border-red-300 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <BoIcon name="close" size={14} />
                              {t('team.cancel_invite')}
                            </button>
                          </span>
                        ) : (
                          <span className="inline-flex flex-wrap items-center justify-end gap-2">
                            {!lockedByRoster && row.status === 'active' && (
                              <button
                                type="button"
                                onClick={() => setChanging(row)}
                                className={rowActionClass}
                              >
                                <BoIcon name="edit" size={14} />
                                {t('team.change_role')}
                              </button>
                            )}

                            {/* Teacher accounts are locked out of a role
                                change (that cargo travels with the roster
                                file) but not out of this — a forgotten
                                password has nothing to do with the roster. */}
                            {row.status === 'active' && (
                              <button
                                type="button"
                                onClick={() => createPasswordReset(row)}
                                disabled={busyId === row.id}
                                className={`${rowActionClass} disabled:cursor-not-allowed disabled:opacity-60`}
                              >
                                <BoIcon
                                  name={busyId === row.id ? 'spinner' : 'key'}
                                  size={14}
                                  className={busyId === row.id ? 'animate-spin' : undefined}
                                />
                                {t('team.reset_password')}
                              </button>
                            )}

                            {row.status === 'active' ? (
                              <button
                                type="button"
                                onClick={() => setRemoving(row)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm font-semibold text-muted-foreground transition hover:border-red-300 hover:text-red-600"
                              >
                                <BoIcon name="close" size={14} />
                                {t('team.remove_access')}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => restoreAccess(row)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm font-semibold text-brand-blue transition hover:border-brand-blue"
                              >
                                <BoIcon name="check" size={14} />
                                {t('team.restore_access')}
                              </button>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </TableShell>

            {/* Why the docente rows have no cargo button. Once under the
                table, not once per row: it is one rule, not eight findings. */}
            {pageRows.some((row) => row.role === 'teacher') && (
              <p className="flex items-start gap-2 border-t border-line px-4 py-3 text-xs text-muted-foreground">
                <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
                {t('team.teacher_locked')}
              </p>
            )}

            {pageCount > 1 && (
              <Pager
                page={currentPage}
                pageCount={pageCount}
                status={t('team.page_status', {
                  from: currentPage * PAGE_SIZE + 1,
                  to: currentPage * PAGE_SIZE + pageRows.length,
                  total: filtered.length,
                })}
                prevLabel={t('team.page_prev')}
                nextLabel={t('team.page_next')}
                onChange={setPage}
              />
            )}
          </>
        )}
      </Card>

      <RoleChangeDialog
        member={changing}
        onClose={() => setChanging(null)}
        onConfirm={applyRoleChange}
      />

      {/* Taking a door away is a confirmation, not a re-authentication: it
          removes power instead of granting it, and the account survives it. */}
      <RemoveAccessDialog
        member={removing}
        onClose={() => setRemoving(null)}
        onConfirm={removeAccess}
      />

      {/* Cancelling an invite is lighter than removing access — there was
          never any access to remove, only a decision still waiting on
          somebody else to act on it. */}
      <CancelInviteDialog
        member={cancelling}
        onClose={() => setCancelling(null)}
        onConfirm={cancelInvite}
      />

      <PasswordResetLinkDialog data={resetLink} onClose={() => setResetLink(null)} />

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}

function RemoveAccessDialog({
  member,
  onClose,
  onConfirm,
}: {
  member: StaffMemberRow | null
  onClose: () => void
  onConfirm: (member: StaffMemberRow) => Promise<void>
}) {
  const t = useTranslations('bo')

  return (
    <ConfirmDialog
      open={member !== null}
      title={t('team.remove_title')}
      body={
        member
          ? t('team.remove_body', { name: `${member.firstName} ${member.lastName}` })
          : ''
      }
      confirmLabel={t('team.remove_confirm')}
      confirmPendingLabel={t('team.removing')}
      cancelLabel={t('team.cancel')}
      closeLabel={t('team.change_close')}
      onClose={onClose}
      onConfirm={async () => {
        if (member) await onConfirm(member)
      }}
    />
  )
}

function CancelInviteDialog({
  member,
  onClose,
  onConfirm,
}: {
  member: StaffMemberRow | null
  onClose: () => void
  onConfirm: (member: StaffMemberRow) => Promise<void>
}) {
  const t = useTranslations('bo')

  return (
    <ConfirmDialog
      open={member !== null}
      title={t('team.cancel_invite_title')}
      body={
        member
          ? t('team.cancel_invite_body', { name: `${member.firstName} ${member.lastName}` })
          : ''
      }
      confirmLabel={t('team.cancel_invite_confirm')}
      confirmPendingLabel={t('team.cancelling')}
      cancelLabel={t('team.cancel')}
      closeLabel={t('team.change_close')}
      onClose={onClose}
      onConfirm={async () => {
        if (member) await onConfirm(member)
      }}
    />
  )
}

/**
 * The generated link, once — same shape as the invite-created step in
 * `NewStaffForm`, as a modal instead of an inline panel since it opens from a
 * table row rather than a form. Copying it is the only way out: there is no
 * "read the token later," here or on the invite side (CLAUDE.md decision on
 * `staff_password_resets.token`, `packages/db/src/schema.ts`).
 */
function PasswordResetLinkDialog({
  data,
  onClose,
}: {
  data: { name: string; link: string } | null
  onClose: () => void
}) {
  const t = useTranslations('bo')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (data) setCopied(false)
  }, [data])

  async function copy() {
    if (!data) return
    try {
      await navigator.clipboard.writeText(data.link)
      setCopied(true)
    } catch {
      // Clipboard permission denied or unavailable — the link stays
      // selectable in the field below, so copying by hand still works.
    }
  }

  return (
    <Dialog
      open={data !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent closeLabel={t('team.change_close')} className="bg-white">
        {data && (
          <>
            <DialogHeader className="gap-2 border-b border-line p-5 pr-14">
              <DialogTitle className="text-base font-semibold text-ink">
                {t('team.reset_link_title')}
              </DialogTitle>
              <DialogDescription>
                {t('team.reset_link_subtitle', { name: data.name })}
              </DialogDescription>
            </DialogHeader>

            <div className="p-5">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('team.invite_link_label')}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <input
                    readOnly
                    value={data.link}
                    onFocus={(event) => event.currentTarget.select()}
                    className="flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
                  />
                  <button
                    type="button"
                    onClick={copy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-brand-blue transition hover:border-brand-blue"
                  >
                    <BoIcon name={copied ? 'check' : 'link'} size={16} />
                    {t(copied ? 'team.invite_copied' : 'team.invite_copy')}
                  </button>
                </span>
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line p-5">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep"
              >
                <BoIcon name="check" size={16} />
                {t('team.invite_done')}
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Local to this screen: one question, one destructive answer, one way out.
 *
 * Tracks its own `pending` state around `onConfirm` — without it, a click
 * that kicks off a network call looked like nothing happened at all, and the
 * obvious next move was to click again.
 */
function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  confirmPendingLabel,
  cancelLabel,
  closeLabel,
  onClose,
  onConfirm,
}: {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  confirmPendingLabel: string
  cancelLabel: string
  closeLabel: string
  onClose: () => void
  onConfirm: () => void | Promise<void>
}) {
  const [pending, setPending] = useState(false)

  /* Reopening on a different row must not carry over the last one's
     in-flight state. */
  useEffect(() => {
    if (open) setPending(false)
  }, [open])

  async function handleConfirm() {
    if (pending) return
    setPending(true)
    try {
      await onConfirm()
    } finally {
      // If `onConfirm` closed the dialog (the success path), `open` already
      // flipped false and this is harmless; on failure it un-disables both
      // buttons so the person can try again.
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onClose()
      }}
    >
      <DialogContent closeLabel={closeLabel} className="bg-white">
        <DialogHeader className="gap-2 border-b border-line p-5 pr-14">
          <DialogTitle className="text-base font-semibold text-ink">{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-end gap-2 p-5">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <BoIcon name={pending ? 'spinner' : 'close'} size={16} className={pending ? 'animate-spin' : undefined} />
            {pending ? confirmPendingLabel : confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
