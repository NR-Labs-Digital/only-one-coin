import {
  CreateStaffProfileUseCase,
  PromoteUserRoleUseCase,
  RetireStaffProfileUseCase,
  UpdateStaffProfileUseCase,
  cargoPermissions,
  defaultPermissionsOf,
  type StaffProfileActor,
} from "@ooc/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeAuditLogRepository } from "./fakes/catalog.js";
import { FakeFreshAuthVerifier, FakeStaffProfileRepository, FakeUserRoleRepository } from "./fakes/staff.js";

/**
 * The cargo rules (OOC-183): nobody hands out what they do not hold, nobody
 * edits their own cargo, master and teacher are never edited, and a cargo
 * retires only once empty. Every write lands in the trail.
 */

const admin: StaffProfileActor = {
  userId: "usr_admin",
  assignment: { role: "admin" },
  permissions: new Set(defaultPermissionsOf("admin")),
};

/** A cargo created for the course team: catalog only. */
const scheduler: StaffProfileActor = {
  userId: "usr_sched",
  assignment: { role: "custom", profileId: "profile_11" },
  permissions: new Set(["catalog.view", "catalog.courses_edit", "team.profiles", "account.self"]),
};

let profiles: FakeStaffProfileRepository;
let audit: FakeAuditLogRepository;

beforeEach(() => {
  profiles = new FakeStaffProfileRepository();
  audit = new FakeAuditLogRepository();
});

describe("CreateStaffProfileUseCase", () => {
  it("creates a cargo with the permissions asked for, and writes the trail", async () => {
    const created = await new CreateStaffProfileUseCase(profiles, audit).run({
      actor: admin,
      name: "  Coordinación   de horarios ",
      permissions: ["catalog.view", "catalog.courses_edit"],
    });
    expect(created.name).toBe("Coordinación de horarios");
    expect(audit.appended.at(-1)).toMatchObject({ action: "staff_profile.created", targetId: created.id });
  });

  it("refuses a permission the actor does not hold", async () => {
    await expect(
      new CreateStaffProfileUseCase(profiles, audit).run({
        actor: scheduler,
        name: "Caja",
        permissions: ["payments.settle"],
      }),
    ).rejects.toMatchObject({ reason: "staff_profile.beyond_own_permissions" });
  });

  it("refuses what no cargo is handed: the teacher portal and the owners' door", async () => {
    for (const permission of ["teaching.own_grades", "settings.feature_flags", "nope.nothing"]) {
      await expect(
        new CreateStaffProfileUseCase(profiles, audit).run({ actor: admin, name: "X Y", permissions: [permission] }),
      ).rejects.toMatchObject({ reason: "staff_profile.permission_not_grantable" });
    }
  });

  it("refuses a name another live cargo has, without case", async () => {
    const useCase = new CreateStaffProfileUseCase(profiles, audit);
    await useCase.run({ actor: admin, name: "Horarios", permissions: [] });
    await expect(useCase.run({ actor: admin, name: "HORARIOS", permissions: [] })).rejects.toMatchObject({
      reason: "staff_profile.name_taken",
    });
  });
});

describe("UpdateStaffProfileUseCase", () => {
  it("lets admin give the enrollment supervisor the course's data, and records what changed", async () => {
    const before = await profiles.findByRole("enrollment_supervisor");
    const result = await new UpdateStaffProfileUseCase(profiles, audit).run({
      actor: admin,
      profileId: before!.id,
      permissions: [...before!.permissions, "catalog.courses_edit"],
    });
    expect(result).toEqual({ added: ["catalog.courses_edit"], removed: [] });
    expect(audit.appended.at(-1)).toMatchObject({
      action: "staff_profile.updated",
      metadata: { role: "enrollment_supervisor", added: ["catalog.courses_edit"], removed: [] },
    });
  });

  it("refuses the actor's own cargo, master and teacher", async () => {
    const useCase = new UpdateStaffProfileUseCase(profiles, audit);
    for (const role of ["admin", "master", "teacher"] as const) {
      const profile = await profiles.findByRole(role);
      await expect(useCase.run({ actor: admin, profileId: profile!.id, permissions: [] })).rejects.toMatchObject({
        reason: role === "admin" ? "staff_profile.own_profile" : "staff_profile.locked",
      });
    }
  });

  it("refuses to reshape a cargo stronger than the actor", async () => {
    const billing = await profiles.findByRole("billing");
    await expect(
      new UpdateStaffProfileUseCase(profiles, audit).run({ actor: scheduler, profileId: billing!.id, permissions: [] }),
    ).rejects.toMatchObject({ reason: "staff_profile.beyond_own_permissions" });
  });
});

describe("RetireStaffProfileUseCase", () => {
  it("retires an empty created cargo, and refuses one still in use", async () => {
    const created = await new CreateStaffProfileUseCase(profiles, audit).run({
      actor: admin,
      name: "Temporal",
      permissions: [],
    });
    const useCase = new RetireStaffProfileUseCase(profiles, audit);

    profiles.members.set(created.id, 1);
    await expect(useCase.run({ actor: admin, profileId: created.id })).rejects.toMatchObject({
      reason: "staff_profile.in_use",
    });

    profiles.members.set(created.id, 0);
    await useCase.run({ actor: admin, profileId: created.id });
    expect(await profiles.findLiveById(created.id)).toBeNull();
  });

  it("retires an empty board cargo, but never master or teacher", async () => {
    const useCase = new RetireStaffProfileUseCase(profiles, audit);

    const sales = await profiles.findByRole("sales");
    profiles.members.set(sales!.id, 2);
    await expect(useCase.run({ actor: admin, profileId: sales!.id })).rejects.toMatchObject({
      reason: "staff_profile.in_use",
    });

    profiles.members.set(sales!.id, 0);
    await useCase.run({ actor: admin, profileId: sales!.id });
    expect(await profiles.findLiveById(sales!.id)).toBeNull();
    expect((await profiles.findByRole("sales"))?.retired).toBe(true);

    for (const role of ["master", "teacher"] as const) {
      const profile = await profiles.findByRole(role);
      await expect(useCase.run({ actor: admin, profileId: profile!.id })).rejects.toMatchObject({
        reason: "staff_profile.locked",
      });
    }
  });

  it("puts nobody on a retired board cargo again", async () => {
    const sales = await profiles.findByRole("sales");
    await new RetireStaffProfileUseCase(profiles, audit).run({ actor: admin, profileId: sales!.id });

    await expect(cargoPermissions(profiles, { role: "sales" })).rejects.toMatchObject({
      reason: "staff_profile.not_found",
    });
  });
});

describe("PromoteUserRoleUseCase with cargos", () => {
  it("moves an account onto a created cargo the actor fully holds", async () => {
    const roles = new FakeUserRoleRepository();
    roles.roles.set("usr_astrid", "enrollment_supervisor");
    const created = await new CreateStaffProfileUseCase(profiles, audit).run({
      actor: admin,
      name: "Horarios",
      permissions: ["catalog.view", "catalog.courses_edit"],
    });
    const result = await new PromoteUserRoleUseCase(new FakeFreshAuthVerifier(), roles, audit, profiles).run({
      adminUserId: "usr_admin",
      adminPassword: "pw",
      adminPermissions: admin.permissions,
      targetUserId: "usr_astrid",
      newRole: "custom",
      newProfileId: created.id,
    });
    expect(result).toEqual({ targetUserId: "usr_astrid", newRole: "custom", newProfileId: created.id });
    expect(await roles.findAssignmentByUserId("usr_astrid")).toEqual({ role: "custom", profileId: created.id });
  });

  it("refuses to hand out, or take from, a cargo stronger than the actor", async () => {
    const roles = new FakeUserRoleRepository();
    roles.roles.set("usr_cash", "billing");
    roles.roles.set("usr_new", "sales");
    const useCase = new PromoteUserRoleUseCase(new FakeFreshAuthVerifier(), roles, audit, profiles);
    const base = { adminUserId: "usr_sched", adminPassword: "pw", adminPermissions: scheduler.permissions };

    await expect(useCase.run({ ...base, targetUserId: "usr_new", newRole: "billing" })).rejects.toMatchObject({
      reason: "staff_profile.beyond_own_permissions",
    });
    await expect(useCase.run({ ...base, targetUserId: "usr_cash", newRole: "support" })).rejects.toMatchObject({
      reason: "staff_profile.beyond_own_permissions",
    });
  });

  it("refuses a created cargo that is gone", async () => {
    const roles = new FakeUserRoleRepository();
    roles.roles.set("usr_x", "sales");
    await expect(
      new PromoteUserRoleUseCase(new FakeFreshAuthVerifier(), roles, audit, profiles).run({
        adminUserId: "usr_admin",
        adminPassword: "pw",
        adminPermissions: admin.permissions,
        targetUserId: "usr_x",
        newRole: "custom",
        newProfileId: "profile_missing",
      }),
    ).rejects.toMatchObject({ reason: "staff_profile.not_found" });
  });
});
