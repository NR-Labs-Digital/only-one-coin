import { createHash } from "node:crypto";
import {
  ConflictError,
  CreateStudentSchema,
  HttpError,
  DEFAULT_LOCALE,
  InvalidFieldsError,
  MAX_PUBLIC_LOT_ITEMS,
  GuardianFieldsSchema,
  LocaleSchema,
  MethodDetailField,
  OperationNumberField,
  PaymentMethodSchema,
  refineGmail,
  refineNationalId,
  UnableToProcessEntryError,
  type SubmitPublicEnrollmentInput,
} from "@ooc/domain";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { RATE_LIMITS, perLotLeadHold, perSeatHold } from "@/shared/http/rateLimit.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

// Version the guardian is agreeing to — CLAUDE.md §8, Ley 29733. Same
// provisional constant GetPublicCatalogRoute sends as `settings.
// consentVersion`; no `settings` table yet to read it from instead.
const CONSENT_VERSION = "v1";

// Same field rules as the entity (normalized, then checked — fields.ts), plus
// the checkout's own Gmail gate. A refusal is a 400 naming each field and its
// code; the checkout translates the code.
const StudentFieldsSchema = CreateStudentSchema.superRefine(refineGmail);

const GuardianBodySchema = GuardianFieldsSchema.omit({ studentId: true })
  .extend({
    // The checkbox, not the record — CLAUDE.md §8: "quem aceita é o
    // apoderado, com a data, a versão e o IP dele", all three stamped by the
    // route below, never accepted from the client. A guardian block the client
    // sends without this ticked is a malformed request, not a business
    // decision for the usecase to make.
    consentAccepted: z.literal(true),
  })
  .superRefine(refineNationalId)
  .nullable();

const PaymentBodySchema = z
  .object({
    method: PaymentMethodSchema,
    methodDetail: MethodDetailField.nullable(),
    operationNumber: OperationNumberField,
    // Minted once by the client at submit and resent unchanged on
    // retry (CLAUDE.md §5) — never generated here.
    idempotencyKey: z.string().uuid(),
  })
  .refine((payment) => payment.method !== "other" || payment.methodDetail !== null, {
    message: "required",
    path: ["methodDetail"],
  });

const SubmitPublicEnrollmentBodySchema = z.object({
  // The Cloudflare Turnstile token from the review step (OOC-24).
  // Single-use: the checkout resets the widget after every attempt.
  captchaToken: z.string().min(1).max(2048),
  // The hold claimed when the checkout settled on the class group
  // (ClaimSeatHoldRoute). Its seat and its channel become this
  // enrollment's; an expired or unknown hold is a 422, and the checkout
  // starts again from the class group step.
  holdId: z.string().uuid(),
  // Minted by RequestReceiptUploadRoute and confirmed by
  // ConfirmReceiptUploadRoute before this call — must belong to the same
  // hold and have actually landed in the bucket, or this is a 422.
  receiptUploadId: z.string().uuid(),
  classGroupId: z.string().uuid(),
  planId: z.string().uuid(),
  student: StudentFieldsSchema,
  guardian: GuardianBodySchema,
  // The language the form was filled in; the e-mails follow it (CLAUDE.md
  // §4). Optional so an older client still enrolls — in es-PE, the default.
  locale: LocaleSchema.default(DEFAULT_LOCALE),
  payment: PaymentBodySchema,
});

/**
 * A lot (OOC-158): several enrollments, one receipt. `people` lists each
 * person once; every item names a hold, the class group and plan it is for,
 * and the person by index. The receipt belongs to the first item's hold. The
 * ceiling is a guard on a public route, not a business rule
 * (`MAX_PUBLIC_LOT_ITEMS`).
 */
const SubmitPublicLotBodySchema = z.object({
  captchaToken: z.string().min(1).max(2048),
  receiptUploadId: z.string().uuid(),
  people: z
    .array(z.object({ student: StudentFieldsSchema, guardian: GuardianBodySchema }))
    .min(1)
    .max(MAX_PUBLIC_LOT_ITEMS),
  items: z
    .array(
      z.object({
        holdId: z.string().uuid(),
        classGroupId: z.string().uuid(),
        planId: z.string().uuid(),
        person: z.number().int().min(0).max(MAX_PUBLIC_LOT_ITEMS - 1),
      }),
    )
    .min(1)
    .max(MAX_PUBLIC_LOT_ITEMS),
  locale: LocaleSchema.default(DEFAULT_LOCALE),
  payment: PaymentBodySchema,
});

type GuardianBody = z.infer<typeof GuardianBodySchema>;

/** The guardian as the usecase takes it: the consent checkbox stays here. */
function guardianInput(guardian: GuardianBody): SubmitPublicEnrollmentInput["people"][number]["guardian"] {
  return guardian
    ? {
        firstName: guardian.firstName,
        lastName: guardian.lastName,
        relationship: guardian.relationship,
        nationalIdType: guardian.nationalIdType,
        nationalId: guardian.nationalId,
        email: guardian.email,
        phone: guardian.phone,
      }
    : null;
}

const SubmitPublicEnrollmentResponseSchema = z.object({
  enrollmentId: z.string().uuid(),
  paymentId: z.string().uuid(),
});

type SubmitPublicEnrollmentResponse = z.infer<typeof SubmitPublicEnrollmentResponseSchema>;

const SubmitPublicLotResponseSchema = z.object({
  /** In the order of the request's items. */
  enrollmentIds: z.array(z.string().uuid()),
  paymentId: z.string().uuid(),
});

type SubmitPublicLotResponse = z.infer<typeof SubmitPublicLotResponseSchema>;

/** The idempotency cache compares requests by this — a hash, so no PII
 * reaches Redis. The captcha token is left out: it changes on every attempt
 * while the request it guards does not. */
function fingerprintOf(body: Record<string, unknown>): string {
  const { captchaToken: _token, ...request } = body;
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

// Public — this IS the front door of the funnel (CLAUDE.md §1). Guarded in
// this order (OOC-24, apps/api/CLAUDE.md "Proteção da rota pública"): the
// per-IP and per-hold rate limits (before and after validation, in the
// plugin), the idempotency cache — a retry of a submit that already went
// through is answered from Redis, with no captcha and no database — then the
// captcha, and only then the usecase.
export const submitPublicEnrollmentRoute = RouteBuilder.post("/enrollments/public")
  .docs({
    tags: ["Enrollments"],
    summary: "Submit the public enrollment checkout",
    description:
      "Creates the student (and guardian, if a minor), turns the checkout seat hold into the enrollment, opens its payment pending and links the confirmed receipt upload to it. Reduced slice: no OCR yet.",
  })
  .public()
  .rateLimit(RATE_LIMITS.enrollmentSubmit, perSeatHold("enrollment-submit", 15, "holdId"))
  .body(SubmitPublicEnrollmentBodySchema)
  .response(201, SubmitPublicEnrollmentResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .response(429, ErrorResponseSchema)
  .response(503, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { holdId, receiptUploadId, classGroupId, planId, student, guardian, payment, locale } = request.body;
    await submitCheckout(
      request,
      reply,
      {
        people: [{ student, guardian: guardianInput(guardian) }],
        items: [{ seatHoldId: holdId, classGroupId, planId, person: 0 }],
        receiptUploadId,
        // The guardian's IP, not the proxy's (infra/edge/clientIp.ts).
        consent: guardian ? { version: CONSENT_VERSION, ip: request.clientIp } : null,
        locale,
        payment,
      },
      // A refused field keeps the path this body has: no `people.0.` prefix.
      (result): SubmitPublicEnrollmentResponse => ({ enrollmentId: result.enrollments[0]!.id, paymentId: result.payment.id }),
      (path) => path.replace(/^people\.0\./, ""),
    );
  });

// The checkout since OOC-158: one or more enrollments, one receipt. Same
// guards, same order, as the route above — the per-hold ceiling counts against
// the first item's hold, the one the receipt was uploaded against.
export const submitPublicLotRoute = RouteBuilder.post("/enrollments/public/lot")
  .docs({
    tags: ["Enrollments"],
    summary: "Submit the public enrollment checkout — one or more enrollments, one receipt",
    description:
      "Creates every student (and guardian, if a minor), turns each checkout seat hold into its enrollment, opens one payment pending for the sum of the plan prices in force and links the confirmed receipt upload to it. One item is the ordinary checkout; more is a lot (OOC-158).",
  })
  .public()
  .rateLimit(RATE_LIMITS.enrollmentSubmit, perLotLeadHold("enrollment-submit", 15))
  .body(SubmitPublicLotBodySchema)
  .response(201, SubmitPublicLotResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .response(429, ErrorResponseSchema)
  .response(503, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { receiptUploadId, people, items, payment, locale } = request.body;
    const anyGuardian = people.some((person) => person.guardian !== null);
    await submitCheckout(
      request,
      reply,
      {
        people: people.map((person) => ({ student: person.student, guardian: guardianInput(person.guardian) })),
        items: items.map((item) => ({
          seatHoldId: item.holdId,
          classGroupId: item.classGroupId,
          planId: item.planId,
          person: item.person,
        })),
        receiptUploadId,
        // The guardian's IP, not the proxy's (infra/edge/clientIp.ts).
        consent: anyGuardian ? { version: CONSENT_VERSION, ip: request.clientIp } : null,
        locale,
        payment,
      },
      (result): SubmitPublicLotResponse => ({
        enrollmentIds: result.enrollments.map((enrollment) => enrollment.id),
        paymentId: result.payment.id,
      }),
    );
  });

type SubmitResult = Awaited<ReturnType<typeof container.useCases.enrollment.submitPublic.run>>;

/**
 * The submit's guards, in this order (OOC-24, apps/api/CLAUDE.md "Proteção da
 * rota pública"): the idempotency cache — a retry of a submit that already
 * went through is answered from Redis, with no captcha and no database —
 * then the captcha, and only then the usecase.
 */
async function submitCheckout<Response>(
  request: FastifyRequest<{ Body: { captchaToken: string; payment: { idempotencyKey: string } } & Record<string, unknown> }>,
  reply: FastifyReply,
  input: SubmitPublicEnrollmentInput,
  respond: (result: SubmitResult) => Response,
  fieldPath: (path: string) => string = (path) => path,
): Promise<void> {
  const { captchaToken, payment } = request.body;

  const attempt = await container.edge.idempotency.begin(
    "enrollment-submit",
    payment.idempotencyKey,
    fingerprintOf(request.body),
  );
  if (attempt.kind === "replay") {
    return void reply.status(201).send(attempt.response as Response);
  }
  if (attempt.kind === "in_progress") {
    // The first attempt is still running; the checkout waits and resends.
    throw new ConflictError({
      reason: "idempotency.in_progress",
      message: "A request with this idempotency key is still being processed.",
    });
  }
  if (attempt.kind === "mismatch") {
    throw new UnableToProcessEntryError({
      reason: "idempotency.key_reused",
      message: "This idempotency key was already used for a different request.",
    });
  }

  let response: Response;
  try {
    const captcha = await container.edge.captcha.verify(captchaToken, request.clientIp);
    if (captcha === "failed") {
      throw new UnableToProcessEntryError({
        reason: "captcha.failed",
        message: "The captcha token was refused.",
      });
    }
    if (captcha === "unavailable") {
      // Closed, not open: no captcha means no submit, not an unguarded one.
      throw new HttpError({
        status: 503,
        reason: "captcha.unavailable",
        message: "The captcha could not be verified.",
      });
    }

    try {
      response = respond(await container.useCases.enrollment.submitPublic.run(input));
    } catch (err) {
      if (err instanceof InvalidFieldsError) {
        throw new InvalidFieldsError(err.fields.map((field) => ({ ...field, path: fieldPath(field.path) })));
      }
      throw err;
    }
  } catch (err) {
    // Nothing settled: the key is free for the corrected resend.
    await attempt.abandon();
    throw err;
  }

  await attempt.complete(response);
  reply.status(201).send(response);
}
