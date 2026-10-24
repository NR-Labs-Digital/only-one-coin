'use client'

import { useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { AUDIT_ACTION_KEYS, AUDIT_ACTIONS, AUDIT_ENTITIES, CATALOG_KIND_ENTITY } from '@ooc/domain/audit-catalog'
import { Link, usePathname, useRouter } from '@/i18n/navigation'
import {
  auditLogSearchParams,
  type AuditActionKey,
  type AuditActor,
  type AuditEntity,
  type AuditLogEntry,
  type AuditLogPage,
  type AuditLogQuery,
} from '@/lib/backoffice/audit-log-query'
import { auditActionLabel, auditRoleLabel } from '@/lib/backoffice/audit-labels'
import { downloadBlob } from '@/lib/backoffice/csv'
import { paymentLedgerSearchParams } from '@/lib/backoffice/payment-ledger-query'
import { formatDateTime, type Locale } from '@/lib/format'
import { Card, EmptyState, TableShell, tdClass, thClass, Toolbar } from '@/components/backoffice/ui'
import { Toast } from '@/components/backoffice/controls'
import { BoIcon } from '@/components/backoffice/icons'

const fieldClass =
  'min-h-tap rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15 sm:min-h-0'

type ActionFilter = Exclude<AuditActionKey, 'unknown'>

/**
 * The entities each screen action is about — a retired or restored entry is
 * about whatever catalogue kind it names, so it belongs to all of those. The
 * action filter offers only the actions of the entity chosen.
 */
const ENTITIES_OF_ACTION: ReadonlyMap<ActionFilter, ReadonlySet<AuditEntity>> = (() => {
  const map = new Map<ActionFilter, Set<AuditEntity>>()
  const catalogEntities = new Set<AuditEntity>(Object.values(CATALOG_KIND_ENTITY))
  for (const entry of Object.values(AUDIT_ACTIONS)) {
    const key = entry.key as ActionFilter
    const set = map.get(key) ?? new Set<AuditEntity>()
    for (const entity of entry.entity ? [entry.entity] : catalogEntities) set.add(entity)
    map.set(key, set)
  }
  return map
})()

export interface AuditLinkRights {
  student: boolean
  payment: boolean
  classGroup: boolean
  teacher: boolean
}

/** Where a subject opens, when the reader's cargo opens that screen. */
function subjectHref(subject: NonNullable<AuditLogEntry['subject']>, links: AuditLinkRights): string | null {
  switch (subject.entity) {
    case 'student':
      return links.student ? `/backoffice/students/${subject.id}` : null
    case 'class_group':
      return links.classGroup ? `/backoffice/class-groups/${subject.id}` : null
    case 'teacher':
      return links.teacher ? `/backoffice/teachers/${subject.id}` : null
    case 'payment': {
      /* Pagos opens by search, not by id: the label is the operation number
         (or the student's name when there is none). */
      if (!links.payment) return null
      const search = paymentLedgerSearchParams({
        page: 1,
        state: 'all',
        status: null,
        method: null,
        q: subject.label,
        sort: 'newest',
      })
      return `/backoffice/payments?${search.toString()}`
    }
    default:
      /* Courses, periods and the team are lists with no page per record. */
      return null
  }
}

/**
 * The general audit log (OOC-122): every entry of `audit_log`, newest first,
 * narrowed by period, author, action and entity — all in the URL and all run
 * in Postgres. Each entry says what happened in the reader's language, what it
 * was about (a link when the record still exists and the reader's cargo opens
 * it) and which fields changed — names only, never the values (OOC-74).
 *
 * The first page comes from the server; older entries are fetched here
 * through the same-origin proxy, by the cursor the API hands back.
 */
export function AuditLogView({
  page,
  query,
  actors,
  links,
}: {
  page: AuditLogPage
  query: AuditLogQuery
  actors: AuditActor[]
  links: AuditLinkRights
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const router = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = useTransition()
  const [items, setItems] = useState(page.items)
  const [cursor, setCursor] = useState(page.nextCursor)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const narrowed = Boolean(query.from || query.to || query.actorId || query.action || query.entity)

  function navigate(next: Partial<AuditLogQuery>) {
    const merged = { ...query, ...next }
    // An action that is not about the entity just chosen would list nothing.
    if (next.entity !== undefined && merged.action && merged.entity) {
      if (!ENTITIES_OF_ACTION.get(merged.action)?.has(merged.entity)) merged.action = ''
    }
    const search = auditLogSearchParams(merged).toString()
    startTransition(() => {
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false })
    })
  }

  async function loadMore() {
    if (!cursor) return
    setLoadingMore(true)
    setLoadError(false)
    try {
      const search = auditLogSearchParams(query)
      search.set('cursor', cursor)
      const response = await fetch(`/api/v1/audit-log?${search}`)
      if (!response.ok) throw new Error(String(response.status))
      const next = (await response.json()) as AuditLogPage
      setItems((current) => [...current, ...next.items])
      setCursor(next.nextCursor)
    } catch {
      setLoadError(true)
    } finally {
      setLoadingMore(false)
    }
  }

  /** What the URL says the screen shows, every page, written by the server. */
  async function exportLog() {
    setExporting(true)
    try {
      const search = auditLogSearchParams(query)
      search.set('locale', locale)
      const response = await fetch(`/api/backoffice/audit/export?${search}`)
      if (!response.ok) {
        setToast(
          response.status === 403
            ? t('audit_log.export_error_forbidden')
            : response.status === 429
              ? t('audit_log.export_error_rate_limited')
              : t('audit_log.export_error_generic'),
        )
        return
      }
      const count = Number(response.headers.get('x-row-count'))
      const blob = await response.blob()
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' })
      downloadBlob(t('audit_log.export_file_name', { date: today }), blob)
      if (Number.isFinite(count)) setToast(t('audit_log.export_done', { count }))
    } catch {
      setToast(t('audit_log.export_error_generic'))
    } finally {
      setExporting(false)
    }
  }

  const actionOptions = AUDIT_ACTION_KEYS.filter(
    (key) => !query.entity || ENTITIES_OF_ACTION.get(key)?.has(query.entity),
  )
    .map((key) => ({ key, label: auditActionLabel(t, key) }))
    .sort((a, b) => a.label.localeCompare(b.label, locale))

  const columns = [
    t('audit_log.col_date'),
    t('audit_log.col_action'),
    t('audit_log.col_subject'),
    t('audit_log.col_fields'),
    t('audit_log.col_actor'),
  ]

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t('audit_log.subtitle')}</p>

      <Toolbar className="items-end">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          {t('audit_log.filter_from')}
          <input
            type="date"
            value={query.from}
            max={query.to || undefined}
            onChange={(event) => navigate({ from: event.target.value })}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          {t('audit_log.filter_to')}
          <input
            type="date"
            value={query.to}
            min={query.from || undefined}
            onChange={(event) => navigate({ to: event.target.value })}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          {t('audit_log.filter_entity')}
          <select
            value={query.entity}
            onChange={(event) => navigate({ entity: event.target.value as AuditEntity | '' })}
            className={fieldClass}
          >
            <option value="">{t('audit_log.filter_all')}</option>
            {AUDIT_ENTITIES.map((entity) => (
              <option key={entity} value={entity}>
                {t(`audit_log.entity.${entity}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-48 flex-col gap-1 text-xs font-semibold text-muted-foreground">
          {t('audit_log.filter_action')}
          <select
            value={query.action}
            onChange={(event) => navigate({ action: event.target.value as ActionFilter | '' })}
            className={fieldClass}
          >
            <option value="">{t('audit_log.filter_all')}</option>
            {actionOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-48 flex-col gap-1 text-xs font-semibold text-muted-foreground">
          {t('audit_log.filter_actor')}
          <select
            value={query.actorId}
            onChange={(event) => navigate({ actorId: event.target.value })}
            className={fieldClass}
          >
            <option value="">{t('audit_log.filter_all')}</option>
            {actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name}
              </option>
            ))}
          </select>
        </label>

        <div className="ml-auto flex items-center gap-2">
          {narrowed && (
            <button
              type="button"
              onClick={() => navigate({ from: '', to: '', actorId: '', action: '', entity: '' })}
              className="inline-flex min-h-tap items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink sm:min-h-0"
            >
              <BoIcon name="close" size={16} />
              {t('audit_log.clear_filters')}
            </button>
          )}
          {/* The export is itself an entry of this log — the API writes it. */}
          <button
            type="button"
            onClick={() => void exportLog()}
            disabled={exporting}
            title={t('audit_log.export_hint')}
            aria-busy={exporting}
            className="inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:bg-cream disabled:opacity-60 sm:min-h-0"
          >
            <BoIcon name="download" size={16} />
            {exporting ? t('audit_log.exporting') : t('audit_log.export')}
          </button>
        </div>
      </Toolbar>

      <Card className={`min-w-0 transition-opacity ${pending ? 'opacity-60' : ''}`} aria-busy={pending}>
        {items.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={narrowed ? 'search' : 'clock'}
              title={t(narrowed ? 'audit_log.empty_filtered_title' : 'audit_log.empty_title')}
              body={t(narrowed ? 'audit_log.empty_filtered_body' : 'audit_log.empty_body')}
            />
          </div>
        ) : (
          <>
            <TableShell columns={columns}>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column} className={thClass}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((entry) => (
                  <AuditRow key={entry.id} entry={entry} links={links} locale={locale} />
                ))}
              </tbody>
            </TableShell>

            {(cursor || loadError) && (
              <div className="flex flex-col items-center gap-2 border-t border-line/70 p-3">
                {loadError && <p className="text-sm text-red-700">{t('audit_log.load_more_error')}</p>}
                {cursor && (
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                    className="inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:opacity-60"
                  >
                    {loadingMore ? t('audit_log.loading') : t('audit_log.load_more')}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </Card>

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}

function AuditRow({ entry, links, locale }: { entry: AuditLogEntry; links: AuditLinkRights; locale: Locale }) {
  const t = useTranslations('bo')
  const href = entry.subject ? subjectHref(entry.subject, links) : null
  const role = auditRoleLabel(t, entry.actor?.role ?? null)

  return (
    <tr>
      <td className={`${tdClass} whitespace-nowrap text-xs text-muted-foreground`}>{formatDateTime(entry.at, locale)}</td>
      <td className={`${tdClass} font-semibold`}>{auditActionLabel(t, entry.action)}</td>
      <td className={tdClass}>
        {entry.entity ? (
          <span className="flex flex-col leading-tight">
            <span className="text-xs text-muted-foreground">{t(`audit_log.entity.${entry.entity}`)}</span>
            {entry.subject &&
              (href ? (
                <Link href={href} className="font-medium text-brand-blue transition hover:text-brand-blue-deep">
                  {entry.subject.label}
                </Link>
              ) : (
                <span>{entry.subject.label}</span>
              ))}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className={`${tdClass} text-sm`}>
        {entry.fields.length > 0 ? (
          entry.fields.map((field) => t(`audit_log.field.${field}`)).join(', ')
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className={`${tdClass} whitespace-nowrap`}>
        <span className="flex flex-col leading-tight">
          <span>{entry.actor?.name ?? t('audit_log.actor_unknown')}</span>
          {role && <span className="text-xs text-muted-foreground">{role}</span>}
        </span>
      </td>
    </tr>
  )
}
