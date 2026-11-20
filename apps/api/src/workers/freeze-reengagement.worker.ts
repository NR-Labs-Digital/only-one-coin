import { Worker, type ConnectionOptions } from "bullmq";
import { DEFAULT_LOCALE, type SendFreezeReengagementUseCase } from "@ooc/domain";
import { FREEZE_REENGAGEMENT_QUEUE, QUEUE_PREFIX } from "@ooc/queue";
import type { FastifyBaseLogger } from "fastify";

/**
 * The 1, 3 and 6 month e-mails of a frozen enrollment (OOC-84). Keeps nothing
 * of its own: the dedupe key of each e-mail is the freeze and the milestone,
 * so a tick that runs twice writes once, and a lost tick is made up by the
 * next. es-PE, as every enrollment e-mail written by the platform itself.
 */
export function startFreezeReengagementWorker(
  connection: ConnectionOptions,
  logger: FastifyBaseLogger,
  deps: { send: SendFreezeReengagementUseCase },
): Worker {
  return new Worker(
    FREEZE_REENGAGEMENT_QUEUE,
    async () => {
      const { queued } = await deps.send.run({ locale: DEFAULT_LOCALE });
      if (queued > 0) logger.info({ queued }, "freeze re-engagement e-mails queued");
    },
    { connection, prefix: QUEUE_PREFIX, concurrency: 1 },
  );
}
