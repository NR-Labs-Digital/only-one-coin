import { ForbiddenError, LocaleSchema } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

/**
 * Who is signed in to the portal — the first route only a student reaches.
 * Read off the file linked to the account, never off the client. A `student`
 * account no file points at (the old open sign-up) is a 403: the portal has
 * nothing to show it, and the app sends it back to the login.
 */
export const getPortalMeRoute = RouteBuilder.get("/portal/me")
  .docs({ tags: ["Portal"], summary: "The signed-in student", description: "Backs the portal shell's guard." })
  .roles("student")
  .response(
    200,
    z.object({
      firstName: z.string(),
      lastName: z.string(),
      email: z.string(),
      /** The language chosen on the portal profile (OOC-150); null until one is. */
      preferredLocale: LocaleSchema.nullable(),
    }),
  )
  .response(403, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const userId = request.currentUser!.id;
    const [identity, preferredLocale] = await Promise.all([
      container.repositories.portalAccess.findIdentity(userId),
      container.identity.userPreferenceRepository.findPreferredLocale(userId),
    ]);
    if (!identity) {
      throw new ForbiddenError({ reason: "portal.no_student_record", message: "No student file is linked to this account.", path: request.url });
    }
    reply.status(200).send({ ...identity, preferredLocale });
  });
