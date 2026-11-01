import {
  createOutboxRelayQueue,
  createReceiptExtractQueue,
  createReceiptNormalizeQueue,
  createReceiptRereadQueue,
  createReceiptScreenQueue,
  createReceiptUploadRelayQueue,
  createReceiptValidateQueue,
  createRedisConnection,
  createSeatHoldSweepQueue,
  createSendEmailQueue,
  scheduleOutboxRelay,
  scheduleReceiptUploadRelay,
  scheduleSeatHoldSweep,
} from "@ooc/queue";
import {
  ExtractReceiptUseCase,
  RereadReceiptUseCase,
  RECEIPT_EXTRACTION_TIER_PRIMARY,
  RECEIPT_EXTRACTION_TIER_SECONDARY,
} from "@ooc/domain";
import { buildApp } from "./app.js";
import { container } from "./container.js";
import { createReceiptExtractor, receiptOcrModelFor } from "./infra/ocr/createReceiptExtractor.js";
import { startOutboxRelayWorker } from "./workers/outbox-relay.worker.js";
import { startReceiptExtractWorker } from "./workers/receipt-extract.worker.js";
import { startReceiptNormalizeWorker } from "./workers/receipt-normalize.worker.js";
import { startReceiptRereadWorker } from "./workers/receipt-reread.worker.js";
import { startReceiptScreenWorker } from "./workers/receipt-screen.worker.js";
import { startReceiptUploadRelayWorker } from "./workers/receipt-upload-relay.worker.js";
import { startReceiptValidateWorker } from "./workers/receipt-validate.worker.js";
import { startSeatHoldSweepWorker } from "./workers/seat-hold-sweep.worker.js";
import { startSendEmailWorker } from "./workers/send-email.worker.js";

const {
  config,
  config: { PORT, HOST, REDIS_URL, NODE_ENV, BREVO_API_KEY, BREVO_WEBHOOK_TOKEN },
  logger,
  edge,
  notifications,
  storage,
  repositories,
  useCases,
} = container;

const app = await buildApp();

const connection = createRedisConnection(REDIS_URL);

// The rate limit's own connection (OOC-24) is lazy so tests never dial
// Redis, which made the first request after a boot pay for the TCP + AUTH
// handshake — longer than its 250 ms command timeout, so that request's
// counter always failed open with an error in the log. Dial it here instead.
// Not fatal: a counter that cannot reach Redis lets the request through.
await edge.redis.connect().catch((err: unknown) => {
  logger.error({ err }, "edge redis did not connect at boot; rate limits fail open until it does");
});

// Outbox → queue → provider (apps/api/CLAUDE.md, "Notificações"). The relay
// sweeps pending outbox rows onto the send-email queue; the send-email worker
// delivers them through the guarded provider.
const sendEmailQueue = createSendEmailQueue(connection);
const outboxRelayQueue = createOutboxRelayQueue(connection);
await scheduleOutboxRelay(outboxRelayQueue);

const sendEmailWorker = startSendEmailWorker(connection, logger, {
  store: notifications.outbox,
  provider: notifications.provider,
});
const outboxRelayWorker = startOutboxRelayWorker(connection, logger, {
  store: notifications.outbox,
  sendEmailQueue,
});
// Checkout holds (apps/api/CLAUDE.md, "Dois relógios"): expired holds give
// their seat back to the class group, on the database clock.
const seatHoldSweepQueue = createSeatHoldSweepQueue(connection);
await scheduleSeatHoldSweep(seatHoldSweepQueue);
const seatHoldSweepWorker = startSeatHoldSweepWorker(connection, logger, {
  expireSeatHolds: useCases.enrollment.expireSeatHolds,
});

// Receipt uploads (OOC-19): confirm flips a row to `uploaded`, the relay
// offers it to the normalize queue, the worker downscales/greyscales/strips
// EXIF/converts HEIC and writes back `processed` or `rejected`. Once a
// processed receipt is attached to a payment, the same relay offers it to the
// screen queue (OOC-22, antifraud level 0).
//
// OCR level 1 (OOC-20) rides the same relay: once a receipt is processed and
// attached to a payment it is offered to the extract queue too. The model
// client is built here, never in the container — routes load the container,
// and the submit route must not import the AI module (apps/api/CLAUDE.md).
// Every tier goes through OpenRouter; without OPENROUTER_API_KEY the queue
// is not created, nothing is offered, and receipts wait unread. Only tier 1
// runs — tier 2 is wired (its model is validated here at boot, so a
// same-family choice fails now and not in Sessão 29) but nothing escalates.
// The traffic light (OOC-21) rides the same relay once a receipt is both
// screened and read.
const receiptExtractor = createReceiptExtractor(config, RECEIPT_EXTRACTION_TIER_PRIMARY);
const receiptNormalizeQueue = createReceiptNormalizeQueue(connection);
const receiptScreenQueue = createReceiptScreenQueue(connection);
const receiptValidateQueue = createReceiptValidateQueue(connection);
const receiptExtractQueue = receiptExtractor ? createReceiptExtractQueue(connection) : null;
// Re-reads asked for in Payments (Sessão 32) use the same model, so they
// exist only when it does.
const receiptRereadQueue = receiptExtractor ? createReceiptRereadQueue(connection) : null;
const receiptUploadRelayQueue = createReceiptUploadRelayQueue(connection);
await scheduleReceiptUploadRelay(receiptUploadRelayQueue);
const receiptNormalizeWorker = startReceiptNormalizeWorker(connection, logger, {
  store: repositories.receiptUpload,
  objects: storage.objectStore,
});
const receiptUploadRelayWorker = startReceiptUploadRelayWorker(connection, logger, {
  store: repositories.receiptUpload,
  normalizeQueue: receiptNormalizeQueue,
  screenQueue: receiptScreenQueue,
  extractQueue: receiptExtractQueue,
  validateQueue: receiptValidateQueue,
  reread: receiptRereadQueue ? { store: repositories.receiptReread, queue: receiptRereadQueue } : null,
});
const receiptScreenWorker = startReceiptScreenWorker(connection, logger, {
  screenReceiptUpload: useCases.enrollment.screenReceiptUpload,
});
const receiptValidateWorker = startReceiptValidateWorker(connection, logger, {
  validateReceipt: useCases.enrollment.validateReceipt,
});
const receiptExtractWorker = receiptExtractor
  ? startReceiptExtractWorker(connection, logger, {
      extractReceipt: new ExtractReceiptUseCase(
        repositories.receiptExtraction,
        { read: (objectKey) => storage.objectStore.getObject(objectKey) },
        receiptExtractor,
      ),
    })
  : null;
const receiptRereadWorker = receiptExtractor
  ? startReceiptRereadWorker(connection, logger, {
      rereadReceipt: new RereadReceiptUseCase(
        repositories.receiptReread,
        { read: (objectKey) => storage.objectStore.getObject(objectKey) },
        receiptExtractor,
        repositories.platformSettings,
      ),
    })
  : null;

logger.info(
  {
    emailProvider: BREVO_API_KEY ? "brevo" : "log",
    allowlistEnforced: NODE_ENV !== "production",
    receiptExtraction: receiptExtractor
      ? {
          provider: "openrouter",
          tier1: receiptExtractor.modelName,
          tier2: receiptOcrModelFor(config, RECEIPT_EXTRACTION_TIER_SECONDARY) ?? "unset",
        }
      : "off",
  },
  "Workers started: outbox-relay, send-email, seat-hold-sweep, receipt-upload-relay, receipt-normalize, receipt-screen, receipt-validate, receipt-extract, receipt-reread",
);
if (NODE_ENV === "production" && !BREVO_API_KEY) {
  logger.warn("BREVO_API_KEY is not set: transactional e-mails are logged, not sent");
}
if (NODE_ENV === "production" && BREVO_API_KEY && !BREVO_WEBHOOK_TOKEN) {
  logger.warn("BREVO_WEBHOOK_TOKEN is not set: the Brevo webhook refuses every call, so bounces never reach the database");
}
if (NODE_ENV === "production" && !config.API_PROXY_SECRET) {
  logger.warn(
    "API_PROXY_SECRET is not set: the client IP is read from X-Forwarded-For, which a caller bypassing apps/app can forge",
  );
}
if (NODE_ENV === "production" && !receiptExtractor) {
  logger.warn("OPENROUTER_API_KEY is not set: receipts are screened but never read by OCR");
}

app.listen({ port: PORT, host: HOST }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`Server listening at ${address}`);
});

async function shutdown() {
  await app.close();
  await outboxRelayWorker.close();
  await sendEmailWorker.close();
  await seatHoldSweepWorker.close();
  await receiptUploadRelayWorker.close();
  await receiptNormalizeWorker.close();
  await receiptScreenWorker.close();
  await receiptValidateWorker.close();
  await receiptExtractWorker?.close();
  await receiptRereadWorker?.close();
  await outboxRelayQueue.close();
  await sendEmailQueue.close();
  await seatHoldSweepQueue.close();
  await receiptUploadRelayQueue.close();
  await receiptNormalizeQueue.close();
  await receiptScreenQueue.close();
  await receiptValidateQueue.close();
  await receiptExtractQueue?.close();
  await receiptRereadQueue?.close();
  await connection.quit();
  await edge.redis.quit();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
