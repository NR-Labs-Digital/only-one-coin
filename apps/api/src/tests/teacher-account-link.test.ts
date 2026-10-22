import {
  CompleteStaffInviteUseCase,
  CreateStaffInviteUseCase,
  PromoteUserRoleUseCase,
  RestoreStaffAccessUseCase,
  Teacher,
  type CreateTeacherDTO,
  type StaffInvite,
} from "@ooc/domain";
import { describe, expect, it } from "vitest";
import { FakeAuditLogRepository } from "./fakes/catalog.js";
import {
  FakeFreshAuthVerifier,
  FakeStaffAccountProvisioner,
  FakeStaffInviteRepository,
  FakeStaffUserLookup,
  FakeUserRoleRepository,
} from "./fakes/staff.js";
import { FakeStaffAccessRepository, FakeTeacherRepository } from "./fakes/teacher.js";

/**
 * OOC-79: a panel account with the `teacher` cargo belongs to one teacher
 * file. The invite names the file, accepting it writes `teachers.user_id`, and
 * the cargo only enters through that invite and only leaves through the
 * roster — never through a role change in Equipe.
 */

const ANA: CreateTeacherDTO = {
  firstName: "Ana",
  lastName: "Quispe",
  nationalIdType: "DNI",
  nationalId: "12345678",
  email: "ana@example.com",
  phone: "+51900000000",
  nationality: "IT",
  country: "PE",
  region: "Lima",
  city: "Lima",
  addressLine: "Av. Siempre Viva 123",
  languages: ["Italiano"],
  availability: [{ weekday: "tue", startTime: "19:00", endTime: "21:00" }],
};

const INVITE = { actorId: "usr_admin", email: "ana@example.com", firstName: "Ana", lastName: "Quispe" };

function setup(...onFile: Teacher[]) {
  const teachers = new FakeTeacherRepository(...onFile);
  const invites = new FakeStaffInviteRepository();
  const audit = new FakeAuditLogRepository();
  const provisioner = new FakeStaffAccountProvisioner();
  const access = new FakeStaffAccessRepository();
  const roles = new FakeUserRoleRepository();
  return {
    teachers,
    invites,
    audit,
    provisioner,
    access,
    roles,
    create: new CreateStaffInviteUseCase(new FakeStaffUserLookup(), invites, teachers, audit),
    complete: new CompleteStaffInviteUseCase(invites, provisioner, teachers, audit),
    restore: new RestoreStaffAccessUseCase(access, teachers, audit),
    promote: new PromoteUserRoleUseCase(new FakeFreshAuthVerifier(), roles, audit),
  };
}

function pendingTeacherInvite(teacherId: string): StaffInvite {
  return {
    id: "inv_ana",
    email: "ana@example.com",
    firstName: "Ana",
    lastName: "Quispe",
    role: "teacher",
    token: "tok_ana",
    status: "pending",
    teacherId,
    expiresAt: new Date(Date.now() + 86_400_000),
  };
}

describe("CreateStaffInviteUseCase — teacher cargo", () => {
  it("opens the invite for the teacher file and audits which one", async () => {
    const ana = Teacher.create(ANA);
    const { create, audit } = setup(ana);

    const { invite } = await create.run({ ...INVITE, role: "teacher", teacherId: ana.id });

    expect(invite.teacherId).toBe(ana.id);
    expect(audit.appended).toEqual([
      expect.objectContaining({ action: "staff.invite_created", metadata: expect.objectContaining({ teacherId: ana.id }) }),
    ]);
  });

  it("refuses a teacher invite that names no file", async () => {
    const { create, invites } = setup();

    await expect(create.run({ ...INVITE, role: "teacher", teacherId: null })).rejects.toMatchObject({
      status: 422,
      reason: "staff_invite.teacher_required",
    });
    expect(invites.rows).toHaveLength(0);
  });

  it("refuses a file that does not exist", async () => {
    const { create } = setup();

    await expect(
      create.run({ ...INVITE, role: "teacher", teacherId: "00000000-0000-7000-8000-000000000000" }),
    ).rejects.toMatchObject({ status: 422, reason: "staff_invite.teacher_not_found" });
  });

  it("refuses a teacher who already has an account", async () => {
    const ana = new Teacher({ ...Teacher.create(ANA), userId: "usr_ana" });
    const { create, invites } = setup(ana);

    await expect(create.run({ ...INVITE, role: "teacher", teacherId: ana.id })).rejects.toMatchObject({
      status: 422,
      reason: "staff_invite.teacher_has_account",
    });
    expect(invites.rows).toHaveLength(0);
  });

  it("refuses a teacher who left the roster", async () => {
    const ana = new Teacher({ ...Teacher.create(ANA), status: "inactive" });
    const { create } = setup(ana);

    await expect(create.run({ ...INVITE, role: "teacher", teacherId: ana.id })).rejects.toMatchObject({
      reason: "staff_invite.teacher_inactive",
    });
  });

  it("refuses a second open invite for the same file", async () => {
    const ana = Teacher.create(ANA);
    const { create } = setup(ana);
    await create.run({ ...INVITE, role: "teacher", teacherId: ana.id });

    await expect(
      create.run({ ...INVITE, email: "ana.otra@example.com", role: "teacher", teacherId: ana.id }),
    ).rejects.toMatchObject({ reason: "staff_invite.teacher_invite_pending" });
  });

  it("keeps a file off an invite for another cargo", async () => {
    const ana = Teacher.create(ANA);
    const { create } = setup(ana);

    const { invite } = await create.run({ ...INVITE, role: "support", teacherId: ana.id });

    expect(invite.teacherId).toBeNull();
  });
});

describe("CompleteStaffInviteUseCase — teacher cargo", () => {
  it("links the new account to the teacher file", async () => {
    const ana = Teacher.create(ANA);
    const { complete, invites, teachers, audit } = setup(ana);
    invites.rows.push(pendingTeacherInvite(ana.id));

    const { userId } = await complete.run({ token: "tok_ana", password: "a-long-password-1" });

    expect((await teachers.findById(ana.id))?.userId).toBe(userId);
    expect(invites.completed).toEqual([{ id: "inv_ana", userId }]);
    expect(audit.appended).toEqual([
      expect.objectContaining({
        action: "staff.invite_completed",
        metadata: { role: "teacher", teacherId: ana.id, teacherLinked: true },
      }),
    ]);
  });

  it("refuses before opening an account when the file got one meanwhile", async () => {
    const ana = new Teacher({ ...Teacher.create(ANA), userId: "usr_other" });
    const { complete, invites, provisioner } = setup(ana);
    invites.rows.push(pendingTeacherInvite(ana.id));

    await expect(complete.run({ token: "tok_ana", password: "a-long-password-1" })).rejects.toMatchObject({
      reason: "staff_invite.teacher_has_account",
    });
    expect(provisioner.provisioned).toHaveLength(0);
  });

  it("refuses before opening an account when the teacher left the roster meanwhile", async () => {
    const ana = new Teacher({ ...Teacher.create(ANA), status: "inactive" });
    const { complete, invites, provisioner } = setup(ana);
    invites.rows.push(pendingTeacherInvite(ana.id));

    await expect(complete.run({ token: "tok_ana", password: "a-long-password-1" })).rejects.toMatchObject({
      reason: "staff_invite.teacher_inactive",
    });
    expect(provisioner.provisioned).toHaveLength(0);
  });

  it("links nothing for another cargo", async () => {
    const { complete, invites, audit } = setup();
    invites.rows.push({ ...pendingTeacherInvite("unused"), role: "support", teacherId: null });

    await complete.run({ token: "tok_ana", password: "a-long-password-1" });

    expect(audit.appended).toEqual([expect.objectContaining({ metadata: { role: "support" } })]);
  });
});

describe("PromoteUserRoleUseCase — teacher cargo", () => {
  it("refuses moving a teacher account into another cargo", async () => {
    const { promote, roles } = setup();
    roles.roles.set("usr_ana", "teacher");

    await expect(
      promote.run({ adminUserId: "usr_admin", adminPassword: "pw", targetUserId: "usr_ana", newRole: "support" }),
    ).rejects.toMatchObject({ status: 422, reason: "staff_role.teacher_account_locked" });
    expect(roles.roles.get("usr_ana")).toBe("teacher");
  });

  it("refuses moving another account into the teacher cargo", async () => {
    const { promote, roles } = setup();
    roles.roles.set("usr_rosa", "support");

    await expect(
      promote.run({ adminUserId: "usr_admin", adminPassword: "pw", targetUserId: "usr_rosa", newRole: "teacher" }),
    ).rejects.toMatchObject({ reason: "staff_role.teacher_account_locked" });
    expect(roles.roles.get("usr_rosa")).toBe("support");
  });
});

describe("RestoreStaffAccessUseCase — teacher cargo", () => {
  it("refuses reopening the account of a teacher off the roster", async () => {
    const ana = new Teacher({ ...Teacher.create(ANA), userId: "usr_ana", status: "inactive" });
    const { restore, access } = setup(ana);

    await expect(restore.run({ actorId: "usr_admin", targetUserId: "usr_ana" })).rejects.toMatchObject({
      status: 422,
      reason: "staff_access.teacher_inactive",
    });
    expect(access.unbanned).toHaveLength(0);
  });

  it("reopens the account of a teacher still on the roster", async () => {
    const ana = new Teacher({ ...Teacher.create(ANA), userId: "usr_ana" });
    const { restore, access } = setup(ana);

    await restore.run({ actorId: "usr_admin", targetUserId: "usr_ana" });

    expect(access.unbanned).toEqual(["usr_ana"]);
  });
});
