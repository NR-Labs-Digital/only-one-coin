import { CreateStaffInviteUseCase } from "@ooc/domain";
import { renderEmail } from "@ooc/notifications";
import { describe, expect, it } from "vitest";
import { BackofficeInviteLinkBuilder } from "@/infra/identity/BackofficeInviteLinkBuilder.js";
import { FakeAuditLogRepository } from "./fakes/catalog.js";
import { FakeStaffInviteRepository, FakeStaffUserLookup } from "./fakes/staff.js";
import { FakeTeacherRepository } from "./fakes/teacher.js";

/** OOC-138: inviting somebody to the panel e-mails them the link. */

const ORIGIN = "https://backoffice.test";

function setup() {
  const invites = new FakeStaffInviteRepository();
  const useCase = new CreateStaffInviteUseCase(
    new FakeStaffUserLookup(),
    invites,
    new FakeTeacherRepository(),
    new FakeAuditLogRepository(),
    new BackofficeInviteLinkBuilder(ORIGIN),
  );
  return { invites, useCase };
}

const INPUT = {
  actorId: "usr_admin",
  email: "  Rick@Example.com ",
  firstName: "Rick",
  lastName: "Test",
  role: "sales" as const,
};

describe("CreateStaffInviteUseCase e-mail", () => {
  it("sends the invite link to the invited address, once", async () => {
    const { invites, useCase } = setup();

    const { invite } = await useCase.run(INPUT);

    expect(invites.emails).toEqual([
      {
        templateKey: "staff_invite",
        to: "rick@example.com",
        locale: "es-PE",
        vars: {
          recipientName: "Rick Test",
          accessUrl: `${ORIGIN}/backoffice/invite/${invite.token}`,
        },
        dedupeKey: `staff_invite:${invite.id}:staff`,
      },
    ]);
  });

  it("sends nothing when the invite is refused", async () => {
    const { invites, useCase } = setup();
    await useCase.run(INPUT);

    await expect(useCase.run(INPUT)).rejects.toMatchObject({ reason: "staff_invite.email_taken" });

    expect(invites.emails).toHaveLength(1);
  });

  it("renders with the link behind the button in every locale", () => {
    const accessUrl = `${ORIGIN}/backoffice/invite/abc`;

    for (const locale of ["es-PE", "pt-BR", "en"] as const) {
      const { html, text } = renderEmail({
        templateKey: "staff_invite",
        to: "rick@example.com",
        locale,
        vars: { recipientName: "Rick Test", accessUrl },
      });

      expect(html).toContain(accessUrl);
      expect(text).toContain(accessUrl);
    }
  });
});
