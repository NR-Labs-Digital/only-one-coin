import {
  BOARD_ROLES,
  PERMISSION_KEYS,
  comparablePermissions,
  isLockedRole,
  profilePermissions,
  profileRequiresMfa,
  type AuthenticatedUser,
  type StaffProfileActor,
  type StaffProfileListing,
} from "@ooc/domain";
import { z } from "zod";
import { container } from "@/container.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";

const PermissionKeySchema = z.enum(PERMISSION_KEYS as [string, ...string[]]);

const ProfileSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(BOARD_ROLES).nullable(),
  name: z.string().nullable(),
  permissions: z.array(PermissionKeySchema),
  locked: z.boolean(),
  mfaRequired: z.boolean(),
  members: z.number().int(),
  /** Whether the account asking may edit it — the same rules the write applies. */
  editable: z.boolean(),
});

const ListResponseSchema = z.object({ items: z.array(ProfileSchema) });

const ProfileParamsSchema = z.object({ profileId: z.string().uuid() });

const WriteBodySchema = z.object({
  name: z.string().max(200).optional(),
  // A cargo holds at most every permission there is.
  permissions: z.array(z.string().max(80)).max(PERMISSION_KEYS.length),
});

function actorOf(user: AuthenticatedUser): StaffProfileActor {
  return {
    userId: user.id,
    assignment: { role: user.role, profileId: user.profileId ?? null },
    permissions: container.identity.staffAccess.permissionsOf(user),
  };
}

function isOwn(user: AuthenticatedUser, profile: StaffProfileListing): boolean {
  return user.role === "custom" ? user.profileId === profile.id : profile.role === user.role;
}

/** Every live cargo with what it can really do, read the way the authorization hook reads it. */
async function listing(user: AuthenticatedUser) {
  const viewer = container.identity.staffAccess.permissionsOf(user);
  const canEdit = viewer.has("team.profiles");
  const profiles = await container.identity.staffProfileRepository.listLive();
  const order = (profile: StaffProfileListing) =>
    profile.role ? BOARD_ROLES.indexOf(profile.role) : BOARD_ROLES.length;
  return profiles
    .sort((a, b) => order(a) - order(b) || (a.name ?? "").localeCompare(b.name ?? ""))
    .map((profile) => {
      const permissions = profilePermissions(profile);
      const locked = isLockedRole(profile.role);
      return {
        id: profile.id,
        role: profile.role,
        name: profile.name,
        permissions: [...permissions],
        locked,
        mfaRequired: profileRequiresMfa(profile),
        members: profile.members,
        editable:
          canEdit &&
          !locked &&
          !isOwn(user, profile) &&
          comparablePermissions(permissions).every((key) => viewer.has(key)),
      };
    });
}

/** A write is felt by every account on the cargo on its next request. */
async function reloadAccess(): Promise<void> {
  await container.identity.staffAccess.reload();
}

// What each cargo can do (OOC-57), and the cargos administration created
// (OOC-183). Readable by whoever reads the matrix; writing is `team.profiles`.
export const listStaffProfilesRoute = RouteBuilder.get("/staff/permissions")
  .docs({
    tags: ["Identity"],
    summary: "List the cargos and what each can do",
    description: "Board cargos and the ones created in Equipo, with their permissions as the authorization hook reads them.",
  })
  .can("team.permissions")
  .response(200, ListResponseSchema)
  .handler(async (request, reply) => {
    reply.status(200).send({ items: await listing(request.currentUser!) });
  });

export const createStaffProfileRoute = RouteBuilder.post("/staff/profiles")
  .docs({ tags: ["Identity"], summary: "Create a cargo", description: "Holding only permissions the actor holds." })
  .can("team.profiles")
  .body(WriteBodySchema.extend({ name: z.string().max(200) }))
  .response(201, z.object({ id: z.string().uuid() }))
  .response(403, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const profile = await container.useCases.staff.createProfile.run({
      actor: actorOf(request.currentUser!),
      name: request.body.name,
      permissions: request.body.permissions,
    });
    await reloadAccess();
    reply.status(201).send({ id: profile.id });
  });

export const updateStaffProfileRoute = RouteBuilder.patch("/staff/profiles/:profileId")
  .docs({
    tags: ["Identity"],
    summary: "Edit what a cargo can do",
    description: "Replaces the cargo's permissions. Master, teacher and the actor's own cargo are refused.",
  })
  .can("team.profiles")
  .params(ProfileParamsSchema)
  .body(WriteBodySchema)
  .response(200, z.object({ added: z.array(z.string()), removed: z.array(z.string()) }))
  .response(403, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.staff.updateProfile.run({
      actor: actorOf(request.currentUser!),
      profileId: request.params.profileId,
      name: request.body.name,
      permissions: request.body.permissions,
    });
    await reloadAccess();
    reply.status(200).send(result);
  });

export const retireStaffProfileRoute = RouteBuilder.post("/staff/profiles/:profileId/retire")
  .docs({
    tags: ["Identity"],
    summary: "Retire a cargo created in Equipo",
    description: "Only once no account and no open invite is on it.",
  })
  .can("team.profiles")
  .params(ProfileParamsSchema)
  .response(204, z.null())
  .response(403, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    await container.useCases.staff.retireProfile.run({
      actor: actorOf(request.currentUser!),
      profileId: request.params.profileId,
    });
    await reloadAccess();
    reply.status(204).send();
  });
