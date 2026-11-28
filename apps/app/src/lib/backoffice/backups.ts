import { apiFetch } from './api-client'

/*
 * The owners' backups (OOC-153), as `apps/api` reports them. Every code here
 * (status, failure, check, table) is translated by the screen, never shown.
 */

export type BackupRestoreStatus = 'queued' | 'restoring' | 'validating' | 'passed' | 'failed' | 'discarded'

export type BackupRestoreFailure =
  | 'backup_not_found'
  | 'target_unavailable'
  | 'dump_corrupt'
  | 'restore_failed'
  | 'validation_failed'
  | 'interrupted'
  | 'timed_out'
  | 'unexpected_error'

export type BackupRestoreCheckKey =
  | 'tables_present'
  | 'tables_not_empty'
  | 'not_ahead_of_production'
  | 'migrations_match_repository'
  | 'append_only_lock'

export interface BackupFileRow {
  key: string
  takenAt: string
  sizeBytes: number
}

export interface BackupRestoreRow {
  id: string
  backupKey: string
  databaseName: string
  status: BackupRestoreStatus
  failureReason: BackupRestoreFailure | null
  report: {
    rowCounts: Record<string, number | null>
    productionCounts: Record<string, number>
    migrationsInBackup: number
    migrationsInRepository: number
    checks: { check: BackupRestoreCheckKey; passed: boolean; tables?: string[] }[]
    durationSeconds: number
  } | null
  requestedByName: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  discardedAt: string | null
  discardedByName: string | null
}

export interface BackupsOverview {
  canList: boolean
  canRestore: boolean
  backups: BackupFileRow[]
  restores: BackupRestoreRow[]
}

/** `null` when the API could not be read — the screen says so, never an empty list that looks real. */
export async function getBackupsOverview(): Promise<BackupsOverview | null> {
  try {
    const response = await apiFetch('/api/v1/platform/backups')
    if (!response.ok) return null
    return (await response.json()) as BackupsOverview
  } catch {
    return null
  }
}
