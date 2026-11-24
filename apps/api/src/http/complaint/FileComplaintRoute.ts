import { ComplaintFormSchema, DEFAULT_LOCALE, HttpError, LocaleSchema, UnableToProcessEntryError } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { RATE_LIMITS } from "@/shared/http/rateLimit.js";
import { container } from "@/container.js";

const FileComplaintBodySchema = z.object({
  // The Cloudflare Turnstile token. Single-use: the form resets the widget
  // after every attempt that reached here.
  captchaToken: z.string().min(1).max(2048),
  // Minted by the form once per sheet and resent unchanged on retry.
  idempotencyKey: z.string().uuid(),
  // The language of the form; the copy goes out in it.
  locale: LocaleSchema.default(DEFAULT_LOCALE),
  complaint: ComplaintFormSchema,
});

const FiledComplaintResponseSchema = z.object({
  code: z.string(),
  filedAt: z.string(),
});

/**
 * The complaints book's front door (Libro de Reclamaciones, OOC-63). Public:
 * anybody files, student or not. Guarded in this order: the per-IP rate
 * limit (in the plugin, before the body is read), a resend of a sheet already
 * filed — answered with its number, no captcha —, the captcha, and only then
 * the usecase. Answers the sheet's correlative number; the copy goes by e-mail.
 */
export const fileComplaintRoute = RouteBuilder.post("/public/complaints")
  .docs({
    tags: ["Complaints"],
    summary: "File a sheet of the complaints book",
    description: "Writes the sheet (append-only) and queues the consumer's copy by e-mail, in one transaction.",
  })
  .public()
  .rateLimit(RATE_LIMITS.complaintSubmit)
  .body(FileComplaintBodySchema)
  .response(201, FiledComplaintResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .response(429, ErrorResponseSchema)
  .response(503, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { captchaToken, idempotencyKey, locale, complaint } = request.body;
    const useCase = container.useCases.complaint.file;

    const respond = (filed: { code: string; filedAt: Date }) =>
      reply.status(201).header("Cache-Control", "no-store").send({ code: filed.code, filedAt: filed.filedAt.toISOString() });

    const already = await useCase.findFiled(idempotencyKey);
    if (already) return respond(already);

    const captcha = await container.edge.captcha.verify(captchaToken, request.clientIp);
    if (captcha === "failed") {
      throw new UnableToProcessEntryError({ reason: "captcha.failed", message: "The captcha token was refused." });
    }
    if (captcha === "unavailable") {
      // Closed, not open: no captcha means no sheet, not an unguarded one.
      throw new HttpError({ status: 503, reason: "captcha.unavailable", message: "The captcha could not be verified." });
    }

    // The consumer's IP, not the proxy's (infra/edge/clientIp.ts) — Ley 29733.
    return respond(await useCase.run({ form: complaint, locale, ip: request.clientIp, idempotencyKey }));
  });
