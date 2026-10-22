import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { SETTINGS_READ_ROLES } from "./settingsRoles.js";

export const PlatformSettingsResponseSchema = z.object({
  checkoutHoldMinutes: z.number().int(),
  receiptAmountToleranceCents: z.number().int(),
  receiptRejectBelowPercent: z.number().int(),
  reviewWindowDays: z.number().int(),
  ocrLowConfidencePercent: z.number().int(),
  passingGrade: z.number().int(),
  certificateDeadlineBusinessDays: z.number().int(),
  constanciaFeeCents: z.number().int(),
  contractAlertDays: z.number().int(),
});

/**
 * Every platform setting (OOC-41). Readable by every staff cargo — the
 * screens that run on these numbers are not only the settings screen.
 */
export const getPlatformSettingsRoute = RouteBuilder.get("/settings")
  .docs({
    tags: ["Platform"],
    summary: "The settings the backoffice can change without a deploy",
  })
  .roles(...SETTINGS_READ_ROLES)
  .response(200, PlatformSettingsResponseSchema)
  .response(401, ErrorResponseSchema)
  .response(403, ErrorResponseSchema)
  .handler(async (_request, reply) => {
    const settings = await container.repositories.platformSettings.get();

    reply.status(200).send(settings);
  });
