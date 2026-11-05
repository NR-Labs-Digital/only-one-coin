import {
  RemoveStaffAccessUseCase,
  RestoreStaffAccessUseCase,
  RetireStaffAccountUseCase,
  retiredStaffEmail,
  type RetireStaffAccountInput,
} from "@ooc/domain";
import { describe, expect, it } from "vitest";
import { FakeAuditLogRepository } from "./fakes/catalog.js";
import { FakeStaffAccessRepository, FakeTeacherRepository } from "./fakes/teacher.js";

/**
 * OOC-136: "eliminar perfil" retires the account, confirmed by typing its
 * e-mail. The row stays for what points at it, and the e-mail goes free.
 */

const TARGET = "usr_rick";
const EMAIL = "rick@example.com";

function setup() {
  const access = new FakeStaffAccessRepository();
  access.retirable.set(TARGET, { email: EMAIL, role: "sales", hasTeacherFile: false });
  const audit = new FakeAuditLogRepository();
  return { access, audit, retire: new RetireStaffAccountUseCase(access, audit) };
}

const INPUT: RetireStaffAccountInput = {
  actorId: "usr_admin",
  actorRole: "admin",
  targetUserId: TARGET,
  confirmEmail: EMAIL,
};

describe("RetireStaffAccountUseCase", () => {
  it("retires the account under a placeholder e-mail and records it without the address", async () => {
    const { access, audit, retire } = setup();

    await retire.run(INPUT);

    expect(access.retired).toEqual([{ userId: TARGET, retiredEmail: retiredStaffEmail(TARGET) }]);
    expect(audit.appended).toHaveLength(1);
    expect(audit.appended[0]).toMatchObject({
      actorId: "usr_admin",
      action: "staff.account_retired",
      targetId: TARGET,
      metadata: { role: "sales" },
    });
    expect(JSON.stringify(audit.appended[0])).not.toContain(EMAIL);
  });

  it("accepts the e-mail typed in another case or with stray spaces", async () => {
    const { access, retire } = setup();

    await retire.run({ ...INPUT, confirmEmail: "  RICK@example.com " });

    expect(access.retired).toHaveLength(1);
  });

  it("refuses a confirmation that is not the target's e-mail", async () => {
    const { access, audit, retire } = setup();

    await expect(retire.run({ ...INPUT, confirmEmail: "other@example.com" })).rejects.toMatchObject({
      status: 422,
      reason: "staff_account.confirmation_mismatch",
    });

    expect(access.retired).toEqual([]);
    expect(audit.appended).toEqual([]);
  });

  it("refuses the actor's own account", async () => {
    const { access, retire } = setup();

    await expect(retire.run({ ...INPUT, actorId: TARGET })).rejects.toMatchObject({
      status: 403,
      reason: "auth.cannot_act_on_self",
    });

    expect(access.retired).toEqual([]);
  });

  it("answers 404 for an id with no live panel account", async () => {
    const { retire } = setup();

    await expect(retire.run({ ...INPUT, targetUserId: "usr_gone" })).rejects.toMatchObject({
      status: 404,
      reason: "staff_account.not_found",
    });
  });

  it("refuses an account a teacher file points at", async () => {
    const { access, retire } = setup();
    access.retirable.set(TARGET, { email: EMAIL, role: "teacher", hasTeacherFile: true });

    await expect(retire.run(INPUT)).rejects.toMatchObject({
      status: 422,
      reason: "staff_account.teacher_linked",
    });

    expect(access.retired).toEqual([]);
  });

  it("lets an admin retire another admin", async () => {
    const { access, retire } = setup();
    access.retirable.set(TARGET, { email: EMAIL, role: "admin", hasTeacherFile: false });

    await retire.run(INPUT);

    expect(access.retired).toHaveLength(1);
  });

  it("lets only a master retire a master", async () => {
    const { access, retire } = setup();
    access.retirable.set(TARGET, { email: EMAIL, role: "master", hasTeacherFile: false });

    await expect(retire.run(INPUT)).rejects.toMatchObject({
      status: 403,
      reason: "auth.insufficient_privilege",
    });
    expect(access.retired).toEqual([]);

    await retire.run({ ...INPUT, actorRole: "master" });
    expect(access.retired).toHaveLength(1);
  });

  it("keeps a retired account closed: restoring or removing access answers 404, with no audit entry", async () => {
    const { access, audit, retire } = setup();
    await retire.run(INPUT);
    const entries = audit.appended.length;

    const restore = new RestoreStaffAccessUseCase(access, new FakeTeacherRepository(), audit);
    const remove = new RemoveStaffAccessUseCase(access, audit);

    const gone = { status: 404, reason: "staff_account.not_found" };
    await expect(restore.run({ actorId: "usr_admin", targetUserId: TARGET })).rejects.toMatchObject(gone);
    await expect(remove.run({ actorId: "usr_admin", targetUserId: TARGET })).rejects.toMatchObject(gone);
    expect(audit.appended).toHaveLength(entries);
  });
});
