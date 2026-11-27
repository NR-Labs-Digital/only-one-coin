import { z } from "zod";
import {
  BACKUP_RESTORE_CHECKS,
  BACKUP_RESTORE_FAILURES,
  BACKUP_RESTORE_STATUSES,
  type BackupRestoreView,
} from "@ooc/domain";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

/*
 * The owners' backups (OOC-153): list what the backups bucket holds, restore
 * one into a scratch database, and drop that database when done. Owners only,
 * by e-mail like Funcionalidades — `.owners()` at the door, and the usecases
 * check it again. The restore itself runs in the worker, never here.
 */

const BackupRestoreReportSchema = z.object({
  rowCounts: z.record(z.string(), z.number().nullable()),
  productionCounts: z.record(z.string(), z.number()),
  migrationsInBackup: z.number(),
  migrationsInRepository: z.number(),
  checks: z.array(
    z.object({
      check: z.enum(BACKUP_RESTORE_CHECKS),
      passed: z.boolean(),
      tables: z.array(z.string()).optional(),
    }),
  ),
  durationSeconds: z.number(),
});

const BackupRestoreSchema = z.object({
  id: z.string().uuid(),
  backupKey: z.string(),
  databaseName: z.string(),
  status: z.enum(BACKUP_RESTORE_STATUSES),
  failureReason: z.enum(BACKUP_RESTORE_FAILURES).nullable(),
  report: BackupRestoreReportSchema.nullable(),
  requestedByName: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  discardedAt: z.string().nullable(),
  discardedByName: z.string().nullable(),
});

const BackupsOverviewSchema = z.object({
  canList: z.boolean(),
  canRestore: z.boolean(),
  backups: z.array(z.object({ key: z.string(), takenAt: z.string(), sizeBytes: z.number() })),
  restores: z.array(BackupRestoreSchema),
});

const iso = (value: Date | null) => (value ? value.toISOString() : null);

function restoreDto(restore: BackupRestoreView): z.infer<typeof BackupRestoreSchema> {
  return {
    id: restore.id,
    backupKey: restore.backupKey,
    databaseName: restore.databaseName,
    status: restore.status,
    failureReason: restore.failureReason,
    report: restore.report,
    requestedByName: restore.requestedByName,
    createdAt: restore.createdAt.toISOString(),
    startedAt: iso(restore.startedAt),
    finishedAt: iso(restore.finishedAt),
    discardedAt: iso(restore.discardedAt),
    discardedByName: restore.discardedByName,
  };
}

export const getBackupsRoute = RouteBuilder.get("/platform/backups")
  .docs({
    tags: ["Platform"],
    summary: "List the production backups and the restores made from them",
    description: "Restricted to the platform owners' e-mail domain (OOC-153).",
  })
  .owners()
  .response(200, BackupsOverviewSchema)
  .response(401, ErrorResponseSchema)
  .response(403, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const overview = await container.useCases.platform.backups.overview.run({ actorEmail: request.currentUser!.email });
    reply.status(200).send({
      canList: overview.canList,
      canRestore: overview.canRestore,
      backups: overview.backups.map((backup) => ({ ...backup, takenAt: backup.takenAt.toISOString() })),
      restores: overview.restores.map(restoreDto),
    });
  });

export const requestBackupRestoreRoute = RouteBuilder.post("/platform/backup-restores")
  .docs({
    tags: ["Platform"],
    summary: "Restore a backup into a new scratch database",
    description:
      "Queues the restore; the worker creates an empty database, loads the backup and checks it. Production is never written. Writes audit_log.",
  })
  .owners()
  .body(
    z.object({
      backupKey: z.string().min(1).max(200),
      /** The backup's name typed again. */
      confirmation: z.string().max(200),
    }),
  )
  .response(202, z.object({ id: z.string().uuid() }))
  .response(401, ErrorResponseSchema)
  .response(403, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.platform.backups.request.run({
      actorId: request.currentUser!.id,
      actorEmail: request.currentUser!.email,
      backupKey: request.body.backupKey,
      confirmation: request.body.confirmation,
    });
    reply.status(202).send(result);
  });

export const discardBackupRestoreRoute = RouteBuilder.post("/platform/backup-restores/:id/discard")
  .docs({
    tags: ["Platform"],
    summary: "Drop the database a passed restore kept",
    description: "Restricted to the platform owners' e-mail domain. Writes audit_log.",
  })
  .owners()
  .params(z.object({ id: z.string().uuid() }))
  .response(204, z.void())
  .response(401, ErrorResponseSchema)
  .response(403, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .handler(async (request, reply) => {
    await container.useCases.platform.backups.discard.run({
      actorId: request.currentUser!.id,
      actorEmail: request.currentUser!.email,
      restoreId: request.params.id,
    });
    reply.status(204).send();
  });
