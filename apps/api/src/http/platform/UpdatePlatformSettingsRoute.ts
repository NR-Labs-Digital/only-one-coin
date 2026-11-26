import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { PlatformSettingsResponseSchema } from "./GetPlatformSettingsRoute.js";

// Bounds are the usecase's (PLATFORM_SETTING_BOUNDS) and the database's; here
// only the shape — integers and the one on/off switch, any subset, nothing else.
const BodySchema = z
  .object({
    checkoutHoldMinutes: z.number().int(),
    receiptAmountToleranceCents: z.number().int(),
    receiptRejectBelowPercent: z.number().int(),
    reviewWindowDays: z.number().int(),
    ocrLowConfidencePercent: z.number().int(),
    passingGrade: z.number().int(),
    certificateDeadlineBusinessDays: z.number().int(),
    contractAlertDays: z.number().int(),
    gradeSubmissionHours: z.number().int(),
    complaintResponseBusinessDays: z.number().int(),
    progressionRequiresPassingGrade: z.boolean(),
  })
  .partial()
  .strict();

/**
 * Changes any subset of the settings in one transaction (OOC-41). Management
 * only. Applies to the next read; each changed value writes audit_log.
 */
export const updatePlatformSettingsRoute = RouteBuilder.patch("/settings")
  .docs({
    tags: ["Platform"],
    summary: "Change platform settings",
    description:
      "Any subset of the settings. One out of range refuses the whole change (422 platform.invalid_setting). Applies from the next read. Each changed value writes audit_log.",
  })
  .can("settings.edit")
  .body(BodySchema)
  .response(200, PlatformSettingsResponseSchema)
  .response(401, ErrorResponseSchema)
  .response(403, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.platform.updateSettings.run({
      actorId: request.currentUser!.id,
      changes: request.body,
    });

    reply.status(200).send(result);
  });
