'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { formatDateTime, intlLocale, type Locale } from '@/lib/format'
import type {
  BackupFileRow,
  BackupRestoreRow,
  BackupRestoreStatus,
  BackupsOverview,
} from '@/lib/backoffice/backups'
import { Card, EmptyState, StatusBadge, TableShell, tdClass, thClass, type Tone } from '@/components/backoffice/ui'
import { Toast } from '@/components/backoffice/controls'
import { HelpHint } from '@/components/backoffice/help-hint'
import { BoIcon } from '@/components/backoffice/icons'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const RUNNING: BackupRestoreStatus[] = ['queued', 'restoring', 'validating']
const OPEN: BackupRestoreStatus[] = [...RUNNING, 'passed']
/** While a restore runs, the screen re-reads its row this often. */
const POLL_MS = 5_000

const statusTone: Record<BackupRestoreStatus, Tone> = {
  queued: 'neutral',
  restoring: 'info',
  validating: 'info',
  passed: 'success',
  failed: 'danger',
  discarded: 'neutral',
}

const primaryButtonClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40'
const secondaryButtonClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40'
const dangerButtonClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60'

type RequestError = 'mismatch' | 'open' | 'not_found' | 'not_configured' | 'failed'

function requestError(reason: string | undefined): RequestError {
  if (reason === 'backup_restore.confirmation_mismatch') return 'mismatch'
  if (reason === 'backup_restore.already_open') return 'open'
  if (reason === 'backup.not_found') return 'not_found'
  if (reason === 'backup_restore.not_configured') return 'not_configured'
  return 'failed'
}

/**
 * The owners' backups (OOC-153). A restore goes into a new, empty database —
 * never production — and is kept only when every check passes; otherwise its
 * database is dropped on the spot. The screen follows the worker by re-reading
 * the page while a restore runs.
 */
export function BackupsView({ overview }: { overview: BackupsOverview }) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const router = useRouter()
  const [restoring, setRestoring] = useState<BackupFileRow | null>(null)
  const [discarding, setDiscarding] = useState<BackupRestoreRow | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const open = overview.restores.find((restore) => OPEN.includes(restore.status)) ?? null
  const running = open !== null && RUNNING.includes(open.status)
  const latest = open ?? overview.restores[0] ?? null
  const history = overview.restores.filter((restore) => restore !== latest)

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => router.refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [running, router])

  const size = (bytes: number) =>
    new Intl.NumberFormat(intlLocale[locale], {
      style: 'unit',
      unit: 'megabyte',
      maximumFractionDigits: 1,
    }).format(bytes / 1_000_000)

  async function requestRestore(backup: BackupFileRow, confirmation: string): Promise<RequestError | null> {
    try {
      const response = await fetch('/api/v1/platform/backup-restores', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ backupKey: backup.key, confirmation }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { reason?: string } | null
        return requestError(body?.reason)
      }
      setRestoring(null)
      setToast(t('backups.queued_toast'))
      router.refresh()
      return null
    } catch {
      return 'failed'
    }
  }

  async function discard(restore: BackupRestoreRow): Promise<boolean> {
    try {
      const response = await fetch(`/api/v1/platform/backup-restores/${restore.id}/discard`, { method: 'POST' })
      if (!response.ok) return false
      setDiscarding(null)
      setToast(t('backups.discarded_toast'))
      router.refresh()
      return true
    } catch {
      return false
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex items-start gap-3 p-4 text-sm text-ink">
        <BoIcon name="shield" size={18} className="mt-0.5 shrink-0 text-brand-blue" />
        <div className="flex flex-col gap-1">
          <p>{t('backups.intro')}</p>
          <p className="text-muted-foreground">{t('backups.intro_production')}</p>
        </div>
      </Card>

      {!overview.canList && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t('backups.not_configured_list')}
        </p>
      )}
      {overview.canList && !overview.canRestore && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t('backups.not_configured_restore')}
        </p>
      )}

      {latest && (
        <RestoreCard
          restore={latest}
          locale={locale}
          onDiscard={() => setDiscarding(latest)}
        />
      )}

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-ink">
          {t('backups.list_title')}
          <HelpHint what={t('help.backups_list_what')} how={t('help.backups_list_how')} />
        </h2>
        {overview.backups.length === 0 ? (
          <EmptyState icon="doc" title={t('backups.empty_title')} body={t('backups.empty_body')} />
        ) : (
          <Card className="overflow-hidden">
            <TableShell columns={[t('backups.col_taken_at'), t('backups.col_name'), t('backups.col_size'), '']}>
              <thead>
                <tr>
                  <th className={thClass}>{t('backups.col_taken_at')}</th>
                  <th className={thClass}>{t('backups.col_name')}</th>
                  <th className={thClass}>{t('backups.col_size')}</th>
                  <th className={thClass} />
                </tr>
              </thead>
              <tbody>
                {overview.backups.map((backup) => (
                  <tr key={backup.key}>
                    <td className={tdClass}>{formatDateTime(backup.takenAt, locale)}</td>
                    <td className={`${tdClass} break-all font-mono text-xs`}>{backup.key}</td>
                    <td className={`${tdClass} whitespace-nowrap`}>{size(backup.sizeBytes)}</td>
                    <td className={`${tdClass} text-right`}>
                      <button
                        type="button"
                        className={secondaryButtonClass}
                        disabled={!overview.canRestore || open !== null}
                        title={open !== null ? t('backups.restore_blocked') : undefined}
                        onClick={() => setRestoring(backup)}
                      >
                        <BoIcon name="refresh" size={16} />
                        {t('backups.restore')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </Card>
        )}
        {open !== null && overview.backups.length > 0 && (
          <p className="text-sm text-muted-foreground">{t('backups.restore_blocked')}</p>
        )}
      </section>

      {history.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-ink">{t('backups.history_title')}</h2>
          <Card className="overflow-hidden">
            <TableShell
              columns={[t('backups.col_requested_at'), t('backups.col_name'), t('backups.col_status'), t('backups.col_by')]}
            >
              <thead>
                <tr>
                  <th className={thClass}>{t('backups.col_requested_at')}</th>
                  <th className={thClass}>{t('backups.col_name')}</th>
                  <th className={thClass}>{t('backups.col_status')}</th>
                  <th className={thClass}>{t('backups.col_by')}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((restore) => (
                  <tr key={restore.id}>
                    <td className={tdClass}>{formatDateTime(restore.createdAt, locale)}</td>
                    <td className={`${tdClass} break-all font-mono text-xs`}>{restore.backupKey}</td>
                    <td className={tdClass}>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge tone={statusTone[restore.status]} label={t(`backups.status.${restore.status}`)} />
                        {restore.failureReason && (
                          <span className="text-xs text-muted-foreground">
                            {t(`backups.failure.${restore.failureReason}`)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={tdClass}>{restore.requestedByName ?? t('backups.removed_account')}</td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </Card>
        </section>
      )}

      <RestoreDialog backup={restoring} onClose={() => setRestoring(null)} onConfirm={requestRestore} />
      <DiscardDialog restore={discarding} onClose={() => setDiscarding(null)} onConfirm={discard} />
      <Toast key={toast} message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}

function RestoreCard({
  restore,
  locale,
  onDiscard,
}: {
  restore: BackupRestoreRow
  locale: Locale
  onDiscard: () => void
}) {
  const t = useTranslations('bo')
  const running = RUNNING.includes(restore.status)
  const report = restore.report
  const tables = report ? Object.keys(report.rowCounts) : []

  return (
    <Card as="section" className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="flex items-center gap-1.5 text-base font-semibold text-ink">
            {t('backups.current_title')}
            <HelpHint what={t('help.backups_status_what')} how={t('help.backups_status_how')} />
          </h2>
          <p className="break-all font-mono text-xs text-muted-foreground">{restore.backupKey}</p>
          <p className="text-xs text-muted-foreground">
            {t('backups.requested_by', {
              name: restore.requestedByName ?? t('backups.removed_account'),
              at: formatDateTime(restore.createdAt, locale),
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {running && <BoIcon name="spinner" size={16} className="animate-spin text-brand-blue" />}
          <StatusBadge tone={statusTone[restore.status]} label={t(`backups.status.${restore.status}`)} />
        </div>
      </div>

      <p className="text-sm text-ink">{t(`backups.status_body.${restore.status}`)}</p>
      {restore.failureReason && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {t(`backups.failure.${restore.failureReason}`)}
        </p>
      )}

      {restore.status === 'passed' && (
        <div className="flex flex-col gap-1 rounded-lg border border-line bg-cream/40 px-3 py-2 text-sm">
          <span className="flex items-center gap-1.5 font-medium text-ink">
            {t('backups.database')}
            <HelpHint what={t('help.backups_database_what')} how={t('help.backups_database_how')} />
          </span>
          <span className="break-all font-mono text-xs">{restore.databaseName}</span>
        </div>
      )}

      {report && (
        <div className="flex flex-col gap-3">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            {t('backups.checks_title')}
            <HelpHint what={t('help.backups_checks_what')} />
          </h3>
          <ul className="flex flex-col gap-1.5">
            {report.checks.map((check) => (
              <li key={check.check} className="flex items-start gap-2 text-sm">
                <BoIcon
                  name={check.passed ? 'check' : 'close'}
                  size={16}
                  className={`mt-0.5 shrink-0 ${check.passed ? 'text-emerald-600' : 'text-red-600'}`}
                />
                <span className="flex flex-col">
                  <span className="text-ink">
                    {t(`backups.check.${check.check}`, {
                      inBackup: report.migrationsInBackup,
                      inRepository: report.migrationsInRepository,
                    })}
                  </span>
                  {check.tables && check.tables.length > 0 && (
                    <span className="text-xs text-red-700">
                      {check.tables.map((table) => t(`backups.table.${table}`)).join(', ')}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>

          <TableShell columns={[t('backups.col_table'), t('backups.col_restored'), t('backups.col_production')]}>
            <thead>
              <tr>
                <th className={thClass}>{t('backups.col_table')}</th>
                <th className={`${thClass} text-right`}>{t('backups.col_restored')}</th>
                <th className={`${thClass} text-right`}>
                  <span className="inline-flex items-center gap-1.5">
                    {t('backups.col_production')}
                    <HelpHint what={t('help.backups_production_count_what')} />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tables.map((table) => (
                <tr key={table}>
                  <td className={tdClass}>{t(`backups.table.${table}`)}</td>
                  <td className={`${tdClass} text-right tabular-nums`}>
                    {report.rowCounts[table] ?? t('backups.table_missing')}
                  </td>
                  <td className={`${tdClass} text-right tabular-nums`}>{report.productionCounts[table] ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
          <p className="text-xs text-muted-foreground">
            {t('backups.duration', { seconds: report.durationSeconds })}
          </p>
        </div>
      )}

      {restore.status === 'passed' && (
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={dangerButtonClass} onClick={onDiscard}>
            <BoIcon name="trash" size={16} />
            {t('backups.discard')}
          </button>
        </div>
      )}
    </Card>
  )
}

/**
 * Restoring writes a full copy of real student data somewhere new, so it
 * takes the backup's name typed again. The API checks the same.
 */
function RestoreDialog({
  backup,
  onClose,
  onConfirm,
}: {
  backup: BackupFileRow | null
  onClose: () => void
  onConfirm: (backup: BackupFileRow, confirmation: string) => Promise<RequestError | null>
}) {
  const t = useTranslations('bo')
  const [typed, setTyped] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<RequestError | null>(null)

  useEffect(() => {
    setTyped('')
    setPending(false)
    setFailure(null)
  }, [backup])

  const armed = backup !== null && typed.trim() === backup.key

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!backup || !armed || pending) return
    setPending(true)
    setFailure(null)
    try {
      setFailure(await onConfirm(backup, typed.trim()))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={backup !== null} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent closeLabel={t('backups.cancel')} className="bg-white">
        {backup && (
          <form onSubmit={(event) => void submit(event)} autoComplete="off">
            <DialogHeader className="gap-2 border-b border-line p-5 pr-14">
              <DialogTitle className="text-base font-semibold text-ink">{t('backups.restore_title')}</DialogTitle>
              <DialogDescription>{t('backups.restore_body')}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 p-5">
              <label className="flex flex-col gap-1.5">
                <span className="break-all text-sm font-medium text-ink">
                  {t('backups.restore_type_label', { name: backup.key })}
                </span>
                <input
                  type="text"
                  value={typed}
                  onChange={(event) => {
                    setTyped(event.target.value)
                    setFailure(null)
                  }}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full rounded-lg border border-line bg-white px-3 py-2 font-mono text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20"
                />
              </label>
              {failure && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
                >
                  <BoIcon name="alert" size={16} className="mt-0.5 shrink-0" />
                  {t(`backups.error.${failure}`)}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line p-5">
              <button type="button" onClick={onClose} disabled={pending} className={secondaryButtonClass}>
                {t('backups.cancel')}
              </button>
              <button type="submit" disabled={!armed || pending} className={primaryButtonClass}>
                <BoIcon
                  name={pending ? 'spinner' : 'refresh'}
                  size={16}
                  className={pending ? 'animate-spin' : undefined}
                />
                {t('backups.restore_confirm')}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DiscardDialog({
  restore,
  onClose,
  onConfirm,
}: {
  restore: BackupRestoreRow | null
  onClose: () => void
  onConfirm: (restore: BackupRestoreRow) => Promise<boolean>
}) {
  const t = useTranslations('bo')
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setPending(false)
    setFailed(false)
  }, [restore])

  async function confirm() {
    if (!restore || pending) return
    setPending(true)
    setFailed(false)
    try {
      if (!(await onConfirm(restore))) setFailed(true)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={restore !== null} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent closeLabel={t('backups.cancel')} className="bg-white">
        {restore && (
          <div>
            <DialogHeader className="gap-2 border-b border-line p-5 pr-14">
              <DialogTitle className="text-base font-semibold text-ink">{t('backups.discard_title')}</DialogTitle>
              <DialogDescription>{t('backups.discard_body', { name: restore.databaseName })}</DialogDescription>
            </DialogHeader>
            {failed && (
              <p role="alert" className="mx-5 mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {t('backups.error.discard_failed')}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2 p-5">
              <button type="button" onClick={onClose} disabled={pending} className={secondaryButtonClass}>
                {t('backups.cancel')}
              </button>
              <button type="button" onClick={() => void confirm()} disabled={pending} className={dangerButtonClass}>
                <BoIcon
                  name={pending ? 'spinner' : 'trash'}
                  size={16}
                  className={pending ? 'animate-spin' : undefined}
                />
                {t('backups.discard_confirm')}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
