import { LocaleSchema, PERMISSION_KEYS } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { splitName } from "@/infra/identity/splitName.js";
import { container } from "@/container.js";

const StaffRoleSchema = z.enum([
  "master",
  "admin",
  "analyst",
  "enrollment_supervisor",
  "academic_supervisor",
  "academic_assistant",
  "teacher",
  "sales",
  "support",
  "billing",
  "custom",
]);

const GetCurrentStaffResponseSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  role: StaffRoleSchema,
  teacherId: z.string().uuid().nullable(),
  /**
   * True while the linked teacher file waits for the teacher's own onboarding
   * (OOC-103): the docente portal opens on that form instead of its screens.
   * False for every other account.
   */
  teacherOnboardingPending: z.boolean(),
  /** The language chosen on the account page (OOC-150); null until one is. */
  preferredLocale: LocaleSchema.nullable(),
  /**
   * What the account's cargo can do (OOC-183), as the authorization hook reads
   * it — the panel decides what to show from this, never from `role`.
   */
  permissions: z.array(z.enum(PERMISSION_KEYS as [string, ...string[]])),
  /** The name of the cargo created in Equipo, for a `custom` account; null otherwise. */
  profileName: z.string().nullable(),
});

// The signed-in staff member's own identity, read from the session Better
// Auth already resolved (`request.currentUser`, populated by
// `authorizationPlugin` from the session cookie — never from client input,
// CLAUDE.md §8). No usecase behind this: it reshapes an already-authorized
// read for the client, it does not enforce a business rule.
//
// `teacherId` is the teacher file a `teacher` account belongs to
// (`teachers.user_id`, written when its invite is accepted — OOC-79), looked up
// from the session's own user id. Null for every other cargo, and for a
// teacher account no file links to: the panel then shows them no class group.
export const getCurrentStaffRoute = RouteBuilder.get("/me")
  .docs({
    tags: ["Identity"],
    summary: "Get the signed-in staff member's own identity",
    description: "Backs the backoffice shell's role gating and account chip.",
  })
  .can("account.self")
  .response(200, GetCurrentStaffResponseSchema)
  .handler(async (request, reply) => {
    // The authorization plugin's onRequest hook always sets this before a
    // non-public handler runs — narrowed here only so TypeScript knows it.
    const user = request.currentUser!;
    const { firstName, lastName } = splitName(user.name);
    const [teacher, preferredLocale, profile] = await Promise.all([
      user.role === "teacher" ? container.repositories.teacher.findByUserId(user.id) : null,
      container.identity.userPreferenceRepository.findPreferredLocale(user.id),
      user.role === "custom" && user.profileId
        ? container.identity.staffProfileRepository.findLiveById(user.profileId)
        : null,
    ]);

    reply.status(200).send({
      id: user.id,
      firstName,
      lastName,
      email: user.email,
      role: user.role as z.infer<typeof StaffRoleSchema>,
      teacherId: teacher?.id ?? null,
      teacherOnboardingPending: teacher ? !teacher.profileComplete : false,
      preferredLocale,
      permissions: [...container.identity.staffAccess.permissionsOf(user)],
      profileName: profile?.name ?? null,
    });
  });
