import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { RATE_LIMITS } from "@/shared/http/rateLimit.js";
import { container } from "@/container.js";
import { PublicIssuedDocumentSchema } from "./issuedDocumentSchemas.js";

/**
 * The public validation page's read (OOC-59): anyone with a code — off the
 * paper or the QR — asks whether the document is real. Public fields only
 * (status, name, course, dates, issue date); a malformed code and a code
 * nobody issued are the same 404. Per-IP ceiling of its own: the code is
 * random (~40 bits), and the ceiling is what keeps walking it pointless.
 */
export const verifyIssuedDocumentRoute = RouteBuilder.get("/public/issued-documents/:code")
  .docs({ tags: ["Documents"], summary: "Verify an issued document by its code" })
  .public()
  .rateLimit(RATE_LIMITS.documentVerify)
  .params(z.object({ code: z.string().max(64) }))
  .response(200, PublicIssuedDocumentSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const found = await container.documents.issued.verify(request.params.code);
    reply
      .status(200)
      .header("Cache-Control", "no-store")
      .send({
        ...found,
        issuedAt: found.issuedAt.toISOString(),
        revokedAt: found.revokedAt?.toISOString() ?? null,
      });
  });
