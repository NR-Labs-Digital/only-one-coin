'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Card, StatusBadge, type Tone } from '@/components/backoffice/ui'
import { Toast } from '@/components/backoffice/controls'
import { tabClass, tabStripClass } from '@/components/backoffice/tab-strip'
import { BoIcon, type BoIconName } from '@/components/backoffice/icons'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface FlagRow {
  key: string
  surface: 'portal' | 'backoffice' | 'teacher'
  parent: string | null
  envVar: string
  codeDefault: boolean
  envValue: 'on' | 'off' | null
  override: { enabled: boolean; byName: string | null; at: string } | null
  /** What this flag alone resolves to, before its parent has a say. */
  own: boolean
  /** What a reader actually gets — the parent chain applied. */
  effective: boolean
  source: 'env' | 'panel' | 'environment' | 'code'
}

const SURFACES = ['portal', 'backoffice', 'teacher'] as const

type Surface = (typeof SURFACES)[number]

/** One face per surface, so a tab is told apart before it is read. */
const surfaceIcon: Record<Surface, BoIconName> = {
  portal: 'students',
  backoffice: 'dashboard',
  teacher: 'teachers',
}

/**
 * What a flag is, in one word. Three states, and they partition the list: a
 * flag is on the air, or on and covered by a parent that is off, or off.
 */
type FlagState = 'live' | 'hidden' | 'off'

/**
 * Only the exceptions are labelled. A blue switch already says the flag is on
 * and a grey one that it is not, so a green badge on every row was seventeen
 * copies of what the control beside it was saying — and it buried the one row
 * a switch cannot describe: on, and covered by a parent that is off.
 */
const stateTone: Record<FlagState, Tone> = {
  live: 'success',
  hidden: 'warning',
  off: 'neutral',
}

const stateBar: Record<FlagState, string> = {
  live: 'bg-emerald-500',
  hidden: 'bg-amber-500',
  off: 'bg-slate-300',
}

const stateDot: Record<FlagState, string> = {
  live: 'bg-emerald-500',
  hidden: 'bg-amber-500',
  off: 'bg-slate-400',
}

/**
 * A flag key is `portal.payments`; a translation key cannot be, or `portal`
 * would have to be both a leaf and a branch of the same message tree.
 */
function messageKey(key: string): string {
  return key.replace(/\./g, '_')
}

function flagState(row: FlagRow): FlagState {
  if (row.effective) return 'live'
  return row.own ? 'hidden' : 'off'
}

interface Group {
  surface: Surface
  /** The surface's own flag — the one that can take the rest off the air. */
  root: FlagRow
  children: FlagRow[]
  total: number
  exceptions: number
}

/**
 * The switchboard.
 *
 * Two states are shown per flag and they are not the same thing: what the flag
 * itself says (the switch), and what a reader actually gets once its parent
 * has had a say. A section can be on and invisible because the surface above
 * it is off — printing only the second would make the switch look broken, and
 * only the first would be a lie.
 *
 * One surface at a time, behind tabs. Stacked, the three cards made a page
 * nobody could see the end of, and the switch that matters most — the one at
 * the head of a card, which takes a whole surface down — scrolled away from
 * the sections it governs.
 */
export function FeaturesView({
  rows,
  appEnv,
  unlocked,
}: {
  rows: FlagRow[]
  appEnv: string
  unlocked: boolean
}) {
  const t = useTranslations('bo')
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [tab, setTab] = useState<Surface>(SURFACES[0])
  /** Which rows have their detail panel open. Several may be, at once. */
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  /**
   * The surface a click just tried to turn off, held here instead of acted on
   * right away. Every other switch on this screen governs one section; this
   * one takes a whole card's worth of them down in production at once — so it
   * is the one switch that asks first.
   */
  const [confirmOff, setConfirmOff] = useState<Group | null>(null)

  const groups: Group[] = useMemo(
    () =>
      SURFACES.flatMap((surface) => {
        const items = rows.filter((row) => row.surface === surface)
        /* Falling back to the first row keeps the group drawn if the registry
           ever gains a surface with no flag named after it. */
        const root = items.find((row) => row.key === surface) ?? items[0]
        if (!root) return []
        return [
          {
            surface,
            root,
            children: items.filter((row) => row !== root),
            total: items.length,
            exceptions: items.filter((row) => flagState(row) !== 'live').length,
          },
        ]
      }),
    [rows],
  )

  const tally = useMemo(() => {
    const counts: Record<FlagState, number> = { live: 0, hidden: 0, off: 0 }
    /* Changed *here* — an env var outranks the panel, so a flag driven by the
       deploy is not something this screen moved, even if a stale override row
       is still sitting under it. */
    let panel = 0
    for (const row of rows) {
      counts[flagState(row)] += 1
      if (row.override && row.envValue === null) panel += 1
    }
    return { ...counts, panel, total: rows.length }
  }, [rows])

  const current = groups.find((group) => group.surface === tab) ?? groups[0]

  function toggleDetails(key: string) {
    setOpen((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }

  async function write(key: string, enabled: boolean | null) {
    setPending(key)
    try {
      const response = await fetch(`/api/v1/feature-flags/${key}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })

      if (!response.ok) {
        setToast(t('features.write_failed'))
        return
      }

      setToast(
        enabled === null
          ? t('features.reset_done')
          : enabled
            ? t('features.turned_on')
            : t('features.turned_off'),
      )
      /* The rail, the badges and every gate on the screen read the same flags,
         so the whole panel is re-rendered rather than this list patched. */
      router.refresh()
    } catch {
      setToast(t('features.write_failed'))
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {appEnv !== 'production' && (
        <Callout tone="warning" icon="alert">
          {t('features.not_production', { env: appEnv })}
        </Callout>
      )}
      {unlocked && (
        <Callout tone="info" icon="eye">
          {t('features.internal_unlock')}
        </Callout>
      )}

      {/* The tally stays whole while the tabs cut the list: a surface you are
          not looking at is exactly where an unexpected "off" hides. */}
      <Summary tally={tally} />

      {/* Not `SectionTabs`: those are real routes, and these are one registry
          cut three ways — the same screen, no URL to bookmark. */}
      <nav className={tabStripClass}>
        {groups.map((group) => {
          const active = group.surface === tab
          return (
            <button
              key={group.surface}
              type="button"
              onClick={() => setTab(group.surface)}
              aria-current={active ? 'page' : undefined}
              className={tabClass(active)}
            >
              <BoIcon name={surfaceIcon[group.surface]} size={15} />
              {t(`features.surface.${group.surface}`)}
              <span className={active ? 'text-brand-blue/60' : 'text-slate-400'}>
                {group.total}
              </span>
              {group.exceptions > 0 && (
                <>
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full bg-amber-500"
                  />
                  <span className="sr-only">{t('features.tab_alert')}</span>
                </>
              )}
            </button>
          )
        })}
      </nav>

      {current && (
        <Card className="overflow-hidden">
          <SurfaceHeader
            group={current}
            busy={pending === current.root.key}
            disabled={pending !== null}
            detailsOpen={open.has(current.root.key)}
            onDetails={() => toggleDetails(current.root.key)}
            onToggle={(next) => (next ? write(current.root.key, next) : setConfirmOff(current))}
            onReset={() => write(current.root.key, null)}
          />

          {current.children.length > 0 && (
            <ul className="divide-y divide-line/70">
              {current.children.map((row) => (
                <li key={row.key}>
                  <FlagRowItem
                    row={row}
                    busy={pending === row.key}
                    disabled={pending !== null}
                    detailsOpen={open.has(row.key)}
                    onDetails={() => toggleDetails(row.key)}
                    onToggle={(next) => write(row.key, next)}
                    onReset={() => write(row.key, null)}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card className="flex items-start gap-3 p-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sky text-brand-blue">
          <BoIcon name="help" size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{t('features.footnote_title')}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t('features.footnote')}
          </p>
        </div>
      </Card>

      <Toast message={toast} onDismiss={() => setToast(null)} />

      <ConfirmSurfaceOffDialog
        group={confirmOff}
        onClose={() => setConfirmOff(null)}
        onConfirm={async (group) => {
          await write(group.root.key, false)
          setConfirmOff(null)
        }}
      />
    </div>
  )
}

/**
 * Stands between a click and the one switch on this screen that takes a whole
 * card down at once. Turning a surface off is still one PUT, same as any
 * other row — this only makes sure it was meant.
 */
function ConfirmSurfaceOffDialog({
  group,
  onClose,
  onConfirm,
}: {
  group: Group | null
  onClose: () => void
  onConfirm: (group: Group) => Promise<void>
}) {
  const t = useTranslations('bo')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (group) setPending(false)
  }, [group])

  async function handleConfirm() {
    if (!group || pending) return
    setPending(true)
    try {
      await onConfirm(group)
    } finally {
      setPending(false)
    }
  }

  const surface = group ? t(`features.surface.${group.surface}`) : ''

  return (
    <Dialog
      open={group !== null}
      onOpenChange={(next) => {
        if (!next && !pending) onClose()
      }}
    >
      <DialogContent closeLabel={t('features.confirm_off_close')} className="bg-white">
        <DialogHeader className="gap-2 border-b border-line p-5 pr-14">
          <DialogTitle className="text-base font-semibold text-ink">
            {t('features.confirm_off_title', { surface })}
          </DialogTitle>
          <DialogDescription>
            {group
              ? t('features.confirm_off_body', {
                  surface,
                  count: group.children.length,
                })
              : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-end gap-2 p-5">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('features.confirm_off_cancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <BoIcon
              name={pending ? 'spinner' : 'alert'}
              size={16}
              className={pending ? 'animate-spin' : undefined}
            />
            {pending ? t('features.confirm_off_pending') : t('features.confirm_off_confirm')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The whole board in one line: how many features there are and how they split.
 *
 * A bar rather than a row of counters, because three of the four numbers read
 * zero on a healthy platform and a grid of zeroes says nothing. The bar is
 * full and green when everything is in the air, and the moment it is not, the
 * gap is the message.
 */
function Summary({
  tally,
}: {
  tally: Record<FlagState, number> & { panel: number; total: number }
}) {
  const t = useTranslations('bo')
  const states: FlagState[] = ['live', 'hidden', 'off']

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-semibold text-ink">
          {t('features.total', { count: tally.total })}
        </p>
        {tally.panel > 0 && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-brand-blue">
            <BoIcon name="edit" size={13} />
            {t('features.changed_here', { count: tally.panel })}
          </p>
        )}
      </div>

      {/* Proportions, not a progress bar — hence no `role="progressbar"`; the
          legend under it is what carries the numbers to a screen reader. */}
      <div
        aria-hidden="true"
        className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100"
      >
        {states.map((state) =>
          tally[state] === 0 ? null : (
            <span
              key={state}
              className={stateBar[state]}
              style={{ width: `${(tally[state] / tally.total) * 100}%` }}
            />
          ),
        )}
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {states.map((state) => (
          <li
            key={state}
            className={`flex items-center gap-1.5 text-xs ${
              tally[state] === 0 ? 'text-muted-foreground/60' : 'text-muted-foreground'
            }`}
          >
            <span className={`size-1.5 shrink-0 rounded-full ${stateDot[state]}`} />
            <span className="font-semibold text-ink">{tally[state]}</span>
            {t(`features.tally.${state}`, { count: tally[state] })}
          </li>
        ))}
      </ul>
    </Card>
  )
}

/**
 * The head of the open tab: the flag that can take every section under it off
 * the air. Tinted and iconed rather than just bolder, so the switch on this
 * line never gets mistaken for the switch on the next one.
 */
function SurfaceHeader({
  group,
  busy,
  disabled,
  detailsOpen,
  onDetails,
  onToggle,
  onReset,
}: {
  group: Group
  busy: boolean
  disabled: boolean
  detailsOpen: boolean
  onDetails: () => void
  onToggle: (next: boolean) => void
  onReset: () => void
}) {
  const t = useTranslations('bo')
  const panelId = useId()
  const { surface, root, children } = group
  const state = flagState(root)
  const label = t(`features.surface.${surface}`)

  return (
    <div className="flex items-start gap-3 border-b border-line bg-sky-soft px-4 py-3.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white text-brand-blue shadow-card">
        <BoIcon name={surfaceIcon[surface]} size={18} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-ink">{label}</h2>
          {state !== 'live' && (
            <StatusBadge tone={stateTone[state]} label={t(`features.state.${state}`)} />
          )}
          {children.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {t('features.sections_count', { count: children.length })}
            </span>
          )}
          <DetailsToggle
            name={label}
            open={detailsOpen}
            panelId={panelId}
            onClick={onDetails}
          />
        </div>

        {state === 'hidden' && <Warning>{t('features.hidden_by_parent')}</Warning>}
        {state === 'off' && children.length > 0 && (
          <Warning>{t('features.parent_off', { count: children.length })}</Warning>
        )}

        <FlagExtras row={root} disabled={disabled} onReset={onReset} />
        {detailsOpen && <FlagDetails row={root} panelId={panelId} />}
      </div>

      <Switch
        checked={root.own}
        disabled={disabled || root.envValue !== null}
        busy={busy}
        label={label}
        onChange={onToggle}
      />
    </div>
  )
}

function FlagRowItem({
  row,
  busy,
  disabled,
  detailsOpen,
  onDetails,
  onToggle,
  onReset,
}: {
  row: FlagRow
  busy: boolean
  disabled: boolean
  detailsOpen: boolean
  onDetails: () => void
  onToggle: (next: boolean) => void
  onReset: () => void
}) {
  const t = useTranslations('bo')
  const panelId = useId()
  const state = flagState(row)
  const label = t(`features.flag.${messageKey(row.key)}`)

  return (
    /* Indented to where the surface's title starts, past its icon: that gutter
       is what says the row belongs to the switch at the head of the card. It
       closes up on a phone, where the column cannot spare 64px. */
    <div className="flex items-start gap-3 py-3 pl-4 pr-4 sm:pl-16">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink">{label}</span>
          {state !== 'live' && (
            <StatusBadge
              tone={stateTone[state]}
              label={t(`features.state.${state}`)}
              dot={false}
            />
          )}
          <DetailsToggle
            name={label}
            open={detailsOpen}
            panelId={panelId}
            onClick={onDetails}
          />
        </div>

        <FlagExtras row={row} disabled={disabled} onReset={onReset} />
        {detailsOpen && <FlagDetails row={row} panelId={panelId} />}
      </div>

      <Switch
        checked={row.own}
        disabled={disabled || row.envValue !== null}
        busy={busy}
        label={label}
        onChange={onToggle}
      />
    </div>
  )
}

/**
 * The `?` that opens a row's paperwork.
 *
 * The key, where the value came from and who last moved it used to print under
 * every name — seventeen rows of small grey type for something a reader
 * consults about one flag, once, usually when something looks wrong. The row
 * now carries the name, its exception and its switch; the rest is one tap
 * away.
 *
 * 44px of target, held to the row's own height by the negative margins so
 * asking for detail costs nothing in vertical rhythm (CLAUDE.md §5, celular).
 */
function DetailsToggle({
  name,
  open,
  panelId,
  onClick,
}: {
  name: string
  open: boolean
  panelId: string
  onClick: () => void
}) {
  const t = useTranslations('bo')

  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-controls={panelId}
      aria-label={t('features.details_label', { name })}
      className={`group -my-2.5 -mx-1 grid min-h-tap min-w-tap place-items-center rounded-full transition ${
        open ? 'text-brand-blue' : 'text-slate-400 hover:text-brand-blue'
      }`}
    >
      <span
        className={`grid size-5 place-items-center rounded-full transition ${
          open ? 'bg-brand-blue text-white' : 'bg-slate-100 group-hover:bg-sky'
        }`}
      >
        <BoIcon name="help" size={13} />
      </span>
    </button>
  )
}

/**
 * A flag's paperwork: the key to go looking with, where its current value came
 * from, and who last moved it.
 */
function FlagDetails({ row, panelId }: { row: FlagRow; panelId: string }) {
  const t = useTranslations('bo')

  return (
    <div
      id={panelId}
      className="mt-2 flex flex-col gap-1 rounded-lg border border-line bg-slate-50/80 px-3 py-2"
    >
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t(`features.source.${row.source}`, { envVar: row.envVar })}
      </p>
      {row.override && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('features.changed_by', {
            who: row.override.byName ?? t('features.removed_account'),
          })}
        </p>
      )}
      <code className="mt-0.5 font-mono text-[11px] text-slate-500">{row.key}</code>
    </div>
  )
}

/**
 * The consequence line under a flag: a surface that is off and still carries
 * sections, or a flag that is on and covered by a parent.
 *
 * Said once, where the cause is. It used to hang off every child of an off
 * surface, which turned nine rows into nine copies of one sentence and buried
 * the one row that was actually different. It is never behind the `?` either:
 * it is the reason to look at the row, not detail about it.
 */
function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-amber-700">
      <BoIcon name="alert" size={13} className="mt-0.5 shrink-0" />
      {children}
    </p>
  )
}

/**
 * What can be said about a flag besides its switch: that the deploy is holding
 * it, and the way back to what the code declares.
 *
 * The way back is a quiet text control, not an outlined slab. It appears on
 * the one or two rows somebody has touched, and a bordered button that size
 * competed with the switch beside it for the eye while doing the rarer job.
 */
function FlagExtras({
  row,
  disabled,
  onReset,
}: {
  row: FlagRow
  disabled: boolean
  onReset: () => void
}) {
  const t = useTranslations('bo')

  /* An env var is the deploy's own word and outranks this screen (CLAUDE.md
     §5) — the switch says so instead of pretending it can move, and there is
     no way back to the code from here while it holds. */
  const lockedByEnv = row.envValue !== null
  const resettable = row.override !== null && !lockedByEnv

  if (!lockedByEnv && !resettable) return null

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3">
      {lockedByEnv && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20">
          <BoIcon name="key" size={12} />
          {t('features.locked_short')}
        </span>
      )}

      {resettable && (
        <button
          type="button"
          disabled={disabled}
          onClick={onReset}
          className="-ml-1.5 inline-flex min-h-tap items-center gap-1.5 rounded-lg px-1.5 text-xs font-semibold text-brand-blue transition hover:bg-sky disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <BoIcon name="arrow-left" size={13} />
          {t('features.reset', { value: t(row.codeDefault ? 'features.on' : 'features.off') })}
        </button>
      )}
    </div>
  )
}

/**
 * Written by hand rather than pulled in: the panel has no switch primitive
 * yet, and a `role="switch"` button is the whole of one.
 *
 * The track is 44×24 inside a 44×44 target — the touch area the coordination's
 * phone needs (CLAUDE.md §5, celular) without the control reading as a slab of
 * colour on every row. It used to be the full 44 tall and filled, which made a
 * list of seventeen rows a column of blue lozenges.
 */
function Switch({
  checked,
  disabled,
  busy,
  label,
  onChange,
}: {
  checked: boolean
  disabled: boolean
  busy: boolean
  label: string
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group grid min-h-tap w-11 shrink-0 place-items-center rounded-full disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span
        className={`flex h-6 w-11 items-center rounded-full p-0.5 transition group-focus-visible:ring-2 group-focus-visible:ring-brand-blue/40 group-focus-visible:ring-offset-2 ${
          checked ? 'bg-brand-blue' : 'bg-slate-300'
        }`}
      >
        <span
          className={`grid size-5 place-items-center rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        >
          {busy && <BoIcon name="spinner" size={11} className="animate-spin text-brand-blue" />}
        </span>
      </span>
    </button>
  )
}

/**
 * A note about where the reader is standing — not about a flag. Two tones,
 * because the two say different things: one is a warning that this is not
 * production, the other is a fact about this browser.
 */
function Callout({
  tone,
  icon,
  children,
}: {
  tone: 'warning' | 'info'
  icon: BoIconName
  children: React.ReactNode
}) {
  const skin =
    tone === 'warning'
      ? 'border-amber-600/20 bg-amber-50 text-amber-800'
      : 'border-brand-blue/20 bg-sky text-brand-blue-deep'

  return (
    <p
      className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed ${skin}`}
    >
      <BoIcon name={icon} size={14} className="mt-0.5 shrink-0" />
      {children}
    </p>
  )
}
