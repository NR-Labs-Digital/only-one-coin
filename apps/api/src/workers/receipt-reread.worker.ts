import { Worker, type ConnectionOptions } from "bullmq";
import { RECEIPT_REREAD_QUEUE, ReceiptRereadPayloadSchema, type ReceiptRereadPayload, QUEUE_PREFIX } from "@ooc/queue";
import { ReceiptExtractionError, findExtractedField, type RereadReceiptUseCase } from "@ooc/domain";
import type { FastifyBaseLogger } from "fastify";

/**
 * Answers a re-read asked for in Payments (ROADMAP Sessão 32) — the shape of
 * `startReceiptExtractWorker`: a failed call throws so BullMQ retries it
 * (level 1r), and on the last attempt the failure is recorded as the answer.
 *
 * Logs ids, the model, the verdict and the per-field confidence — never a
 * value read off the receipt (CLAUDE.md §6, PII in logs).
 */
export function startReceiptRereadWorker(
  connection: ConnectionOptions,
  logger: FastifyBaseLogger,
  deps: { rereadReceipt: RereadReceiptUseCase },
): Worker<ReceiptRereadPayload> {
  return new Worker<ReceiptRereadPayload>(
    RECEIPT_REREAD_QUEUE,
    async (job) => {
      const { rereadId } = ReceiptRereadPayloadSchema.parse(job.data);
      const attempt = job.attemptsMade + 1;

      try {
        const { extraction, outcome } = await deps.rereadReceipt.run({ rereadId });
        if (!extraction) {
          return;
        }
        logger.info(
          {
            rereadId,
            model: extraction.modelName,
            modelVersion: extraction.modelVersion,
            confidence: Object.fromEntries(extraction.fields.map((field) => [field.field, field.confidence])),
            amountRead: findExtractedField(extraction, "amount_cents")?.value != null,
            operationNumberRead: findExtractedField(extraction, "operation_number")?.value != null,
            verdict: outcome?.verdict,
            reason: outcome?.reason,
          },
          "receipt re-read",
        );
      } catch (error) {
        const reason = error instanceof ReceiptExtractionError ? error.reason : "unexpected_error";
        const providerStatus = error instanceof ReceiptExtractionError ? error.providerStatus : null;

        if (attempt < (job.opts.attempts ?? 1)) {
          logger.warn({ rereadId, attempt, reason, providerStatus }, "receipt re-read attempt failed, will retry");
          throw error;
        }

        const recorded = await deps.rereadReceipt.recordFailure({ rereadId, error });
        logger.error({ rereadId, attempt, reason, providerStatus, recorded }, "receipt re-read gave up");
      }
    },
    // A handful at a time: a re-read is a person's click, not a backlog.
    { connection, prefix: QUEUE_PREFIX, concurrency: 2 },
  );
}
