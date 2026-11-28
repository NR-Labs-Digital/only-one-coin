import { spawn } from "node:child_process";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import pg from "pg";
import {
  BACKUP_CORE_TABLES,
  DumpRestoreError,
  type BackupCoreTable,
  type IDumpRestorer,
  type RestoredDatabaseInspection,
} from "@ooc/domain";
import { createDumpFilter } from "./dumpFilter.js";

/** A restore of the production dump takes seconds today; an hour means something is stuck. */
const RESTORE_TIMEOUT_MS = 60 * 60_000;

/**
 * Loads a backup with psql 18, the way `scripts/restore-backup.sh` does
 * (OOC-50), from inside the API's worker (OOC-153): the gzip streams from the
 * bucket through gunzip and the line filter straight into psql's stdin, so
 * the dump is never held whole on disk or in memory.
 *
 * `-1` + `ON_ERROR_STOP`: one transaction, and the first error rolls all of
 * it back — a half-restored database is never left to be checked.
 *
 * The connection goes in libpq's environment variables, never on psql's
 * command line, where any process on the machine could read the password.
 * Nothing psql writes reaches a log: an error line can carry a row's content.
 * Only the line number of the dump where it stopped is kept.
 */
export class PsqlDumpRestorer implements IDumpRestorer {
  constructor(
    private readonly openBackup: (key: string) => Promise<Readable | null>,
    private readonly psqlPath: string,
  ) {}

  async restore(input: { backupKey: string; connectionUri: string }): Promise<void> {
    await assertEmpty(input.connectionUri);

    const source = await this.openBackup(input.backupKey);
    if (!source) throw new DumpRestoreError("backup_not_found");

    const child = spawn(this.psqlPath, ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-1"], {
      env: { ...libpqEnv(input.connectionUri), PATH: process.env.PATH ?? "" },
      stdio: ["pipe", "ignore", "pipe"],
    });

    let stderrTail = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(-4096);
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, RESTORE_TIMEOUT_MS);

    const exited = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code));
    });

    // A stream that breaks midway (truncated gzip) ends psql's stdin, and psql
    // could still COMMIT what it got before the kill lands. Harmless: every
    // failure drops the scratch database (RunNextBackupRestoreUseCase).
    let streamError: unknown = null;
    try {
      await pipeline(source, createGunzip(), createDumpFilter(), child.stdin);
    } catch (error) {
      streamError = error;
      child.kill("SIGTERM");
    }

    let code: number | null;
    try {
      code = await exited;
    } catch (error) {
      clearTimeout(timer);
      throw new DumpRestoreError("restore_failed", { cause: new Error(`psql did not start: ${(error as Error).message}`) });
    } finally {
      clearTimeout(timer);
    }

    if (timedOut) throw new DumpRestoreError("timed_out");
    if (streamError && isGzipError(streamError)) {
      throw new DumpRestoreError("dump_corrupt", { cause: new Error("the backup is not a complete gzip") });
    }
    if (code !== 0 || streamError) {
      const line = /psql:<stdin>:(\d+): (?:ERROR|FATAL)/.exec(stderrTail)?.[1];
      throw new DumpRestoreError("restore_failed", {
        cause: new Error(`psql exited ${code ?? "by signal"}${line ? ` at dump line ${line}` : ""}`),
      });
    }
  }

  async inspect(connectionUri: string): Promise<RestoredDatabaseInspection> {
    return withClient(connectionUri, async (client) => {
      const rowCounts = {} as Record<BackupCoreTable, number | null>;
      for (const table of BACKUP_CORE_TABLES) {
        const exists = await client.query<{ present: boolean }>(
          "select to_regclass($1) is not null as present",
          [`public.${table}`],
        );
        if (!exists.rows[0]?.present) {
          rowCounts[table] = null;
          continue;
        }
        // The name comes from the fixed list above, never from input.
        const counted = await client.query<{ n: string }>(`select count(*) as n from public."${table}"`);
        rowCounts[table] = Number(counted.rows[0]?.n ?? 0);
      }

      let migrationStamps: number[] = [];
      const hasJournal = await client.query<{ present: boolean }>(
        "select to_regclass('drizzle.__drizzle_migrations') is not null as present",
      );
      if (hasJournal.rows[0]?.present) {
        const stamps = await client.query<{ created_at: string }>(
          "select created_at from drizzle.__drizzle_migrations order by id",
        );
        migrationStamps = stamps.rows.map((row) => Number(row.created_at));
      }

      // The 0011 trigger fires per statement, so an UPDATE that matches no row
      // is still refused — with its own SQLSTATE. Inside a transaction rolled
      // back either way: nothing is written even if the lock is missing.
      let appendOnlyLockHolds = false;
      if (rowCounts.audit_log !== null) {
        await client.query("begin");
        try {
          await client.query("update public.audit_log set action = action where false");
        } catch (error) {
          appendOnlyLockHolds = (error as { code?: string }).code === "OOC01";
        } finally {
          await client.query("rollback");
        }
      }

      return { rowCounts, migrationStamps, appendOnlyLockHolds };
    });
  }
}

/** Never over a database with tables — the line that keeps production safe. */
async function assertEmpty(connectionUri: string): Promise<void> {
  const tables = await withClient(connectionUri, async (client) => {
    const result = await client.query<{ n: string }>(
      "select count(*) as n from information_schema.tables where table_schema not in ('pg_catalog', 'information_schema')",
    );
    return Number(result.rows[0]?.n ?? 0);
  });
  if (tables !== 0) {
    throw new DumpRestoreError("restore_failed", { cause: new Error("the target database is not empty") });
  }
}

async function withClient<T>(connectionUri: string, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: connectionUri });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** A `postgres://` URI as libpq's variables. */
export function libpqEnv(connectionUri: string): Record<string, string> {
  const url = new URL(connectionUri);
  const env: Record<string, string> = {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  const channelBinding = url.searchParams.get("channel_binding");
  if (channelBinding) env.PGCHANNELBINDING = channelBinding;
  return env;
}

function isGzipError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "Z_DATA_ERROR" || code === "Z_BUF_ERROR";
}
