import { describe, expect, it } from "vitest";
import { BackofficeInviteLinkBuilder } from "@/infra/identity/BackofficeInviteLinkBuilder.js";
import { BackofficePasswordResetLinkBuilder } from "@/infra/identity/BackofficePasswordResetLinkBuilder.js";

/** A teacher's invite and reset open on the teacher domain, where the portal reads the session. */

const ORIGINS = { backoffice: "https://backoffice.test", teacher: "https://teacher.test" };

describe("staff links pick the door from the cargo", () => {
  it("opens a teacher invite on the teacher domain, anybody else's on the panel", () => {
    const builder = new BackofficeInviteLinkBuilder(ORIGINS);
    expect(builder.build("tok", "es-PE", "teacher")).toBe("https://teacher.test/backoffice/invite/tok");
    expect(builder.build("tok", "en", "admin")).toBe("https://backoffice.test/en/backoffice/invite/tok");
  });

  it("opens a teacher password reset on the teacher domain, anybody else's on the panel", () => {
    const builder = new BackofficePasswordResetLinkBuilder(ORIGINS);
    expect(builder.build("tok", "pt-BR", "teacher")).toBe("https://teacher.test/pt/backoffice/reset-password/tok");
    expect(builder.build("tok", "es-PE", "billing")).toBe("https://backoffice.test/backoffice/reset-password/tok");
  });
});
