import { LocaleSchema } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { container } from "@/container.js";

// The language the signed-in account chose on its own profile (OOC-150): the
// student's Perfil, the panel's and the docente's Cuenta. The account is the
// session's own — the body carries no id (CLAUDE.md §8, anti-IDOR). Saved so
// the next sign-in, on any device, opens in it; the route locale still wins
// while the person is on a page.
//
// No usecase and no audit entry: it is a display preference the person sets
// on themselves, with no rule to enforce — the CHECK of 0053 and the body
// schema already hold the value to the three locales.
export const setOwnPreferredLocaleRoute = RouteBuilder.put("/me/locale")
  .docs({
    tags: ["Identity"],
    summary: "Save the signed-in account's preferred language",
    description: "Any signed-in account, staff or student. The next sign-in opens in this language.",
  })
  .roles(
    "master",
    "admin",
    "analyst",
    "enrollment_supervisor",
    "academic_supervisor",
    "teacher",
    "sales",
    "support",
    "billing",
    "student",
  )
  .body(z.object({ locale: LocaleSchema }))
  .response(204, z.null())
  .handler(async (request, reply) => {
    await container.identity.userPreferenceRepository.setPreferredLocale(request.currentUser!.id, request.body.locale);
    reply.status(204).send();
  });
