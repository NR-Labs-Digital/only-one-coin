import { Worker, type ConnectionOptions } from "bullmq";
import { DEFAULT_LOCALE, type SendCourseEndingRenewalUseCase } from "@ooc/domain";
import { COURSE_ENDING_RENEWAL_QUEUE, QUEUE_PREFIX } from "@ooc/queue";
import type { FastifyBaseLogger } from "fastify";

/**
 * The renewal e-mail, seven days before the class group ends (OOC-53). Keeps
 * nothing of its own: the dedupe key is the enrollment and the end day, so the
 * hourly ticks of the same day write once. es-PE, as every enrollment e-mail
 * written by the platform itself.
 */
export function startCourseEndingRenewalWorker(
  connection: ConnectionOptions,
  logger: FastifyBaseLogger,
  deps: { send: SendCourseEndingRenewalUseCase },
): Worker {
  return new Worker(
    COURSE_ENDING_RENEWAL_QUEUE,
    async () => {
      const { queued } = await deps.send.run({ locale: DEFAULT_LOCALE, now: new Date() });
      if (queued > 0) logger.info({ queued }, "course ending renewal e-mails queued");
    },
    { connection, prefix: QUEUE_PREFIX, concurrency: 1 },
  );
}
