import {
  EMAIL_CATALOG,
  EMAIL_CATALOG_KEYS,
  EMAIL_TEMPLATE_KEYS,
  LocaleSchema,
  type AuthenticatedUser,
  type EmailCatalogKey,
} from "@ooc/domain";
import { renderEmail, type OutgoingEmail } from "@ooc/notifications";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";
import type { EmailFlowCounts } from "@/infra/persistence/notification/EmailFlowCountsQuery.js";
import { EMAIL_PREVIEW_SAMPLES } from "@/http/email/emailPreviewSamples.js";

/**
 * OOC-88: the automatic e-mails' catalog comes from the one catalog (OOC-87)
 * with the outbox counts beside it, and the preview is the repository template
 * rendered by the same `renderEmail` the worker sends with. No database: the
 * counts query is stubbed.
 */

const SUPERVISOR: AuthenticatedUser = {
  id: "u-sup",
  email: "s@example.com",
  name: "S",
  role: "enrollment_supervisor",
  twoFactorEnabled: true,
};

function countsWith(overrides: Partial<Record<EmailCatalogKey, EmailFlowCounts>>) {
  return Object.fromEntries(
    EMAIL_CATALOG_KEYS.map((key) => [key, overrides[key] ?? { sent: 0, failed: 0, blocked: 0 }]),
  ) as Record<EmailCatalogKey, EmailFlowCounts>;
}

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function signedIn() {
  vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(SUPERVISOR);
  vi.spyOn(container.edge.rateLimiter, "hit").mockResolvedValue(null);
}

const get = (url: string) => app.inject({ method: "GET", url, cookies: { [SESSION_COOKIE_NAME]: "token" } });

describe("GET /emails/flows", () => {
  it("lists the whole catalog in order, with the counts and a version only where a template exists", async () => {
    signedIn();
    vi.spyOn(container.queries.emailFlowCounts, "run").mockResolvedValue(
      countsWith({ payment_approved: { sent: 12, failed: 2, blocked: 1 } }),
    );

    const response = await get("/api/v1/emails/flows");

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      windowDays: number;
      items: { key: string; emitted: boolean; version: string | null; counts: EmailFlowCounts }[];
    }>();
    expect(body.windowDays).toBe(30);
    expect(body.items.map((item) => item.key)).toEqual(EMAIL_CATALOG_KEYS);
    for (const item of body.items) {
      expect(item).toMatchObject(EMAIL_CATALOG[item.key as EmailCatalogKey]);
      if (item.emitted) expect(item.version).toMatch(/^[0-9a-f]{8}$/);
      else expect(item.version).toBeNull();
    }
    expect(body.items.find((item) => item.key === "payment_approved")?.counts).toEqual({
      sent: 12,
      failed: 2,
      blocked: 1,
    });
  });
});

describe("GET /emails/flows/:key", () => {
  it("answers one entry", async () => {
    signedIn();
    vi.spyOn(container.queries.emailFlowCounts, "run").mockResolvedValue(
      countsWith({ portal_credentials: { sent: 3, failed: 0, blocked: 0 } }),
    );

    const response = await get("/api/v1/emails/flows/portal_credentials");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      windowDays: 30,
      flow: { key: "portal_credentials", audience: "student", emitted: true, counts: { sent: 3 } },
    });
  });

  it("refuses a key the catalog does not name", async () => {
    signedIn();
    const run = vi.spyOn(container.queries.emailFlowCounts, "run");

    const response = await get("/api/v1/emails/flows/welcome_back");

    expect(response.statusCode).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("GET /emails/flows/:key/preview", () => {
  for (const key of EMAIL_TEMPLATE_KEYS) {
    for (const locale of LocaleSchema.options) {
      it(`renders ${key} in ${locale} exactly as the worker would`, async () => {
        signedIn();

        const response = await get(`/api/v1/emails/flows/${key}/preview?locale=${locale}`);

        expect(response.statusCode).toBe(200);
        const body = response.json<{ locale: string; subject: string; html: string; text: string; to: string }>();
        const expected = renderEmail({
          to: body.to,
          templateKey: key,
          locale,
          vars: EMAIL_PREVIEW_SAMPLES[key],
        } as OutgoingEmail);
        expect(body).toMatchObject({ locale, ...expected });
      });
    }
  }

  it("renders in es-PE when no locale is asked for", async () => {
    signedIn();

    const response = await get("/api/v1/emails/flows/payment_approved/preview");

    expect(response.json()).toMatchObject({ locale: "es-PE" });
  });

  it("refuses a template nothing sends yet: there are no words to render", async () => {
    signedIn();

    const response = await get("/api/v1/emails/flows/certificate_issued/preview");

    expect(response.statusCode).toBe(400);
  });
});

describe("POST /emails/flows/:key/proof (OOC-89)", () => {
  const post = (url: string, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url, payload, cookies: { [SESSION_COOKIE_NAME]: "token" } });

  it("writes one proof per address over the sample data, in the language asked for", async () => {
    signedIn();
    const send = vi
      .spyOn(container.useCases.emails.sendProof, "run")
      .mockResolvedValue({ outboxIds: ["o-1", "o-2"] });

    const response = await post("/api/v1/emails/flows/payment_approved/proof", {
      locale: "pt-BR",
      recipients: ["qa.one@onlyonecoin.edu.pe", "qa.two@onlyonecoin.edu.pe"],
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ sent: 2 });
    expect(send).toHaveBeenCalledWith({
      actorId: SUPERVISOR.id,
      templateKey: "payment_approved",
      locale: "pt-BR",
      recipients: ["qa.one@onlyonecoin.edu.pe", "qa.two@onlyonecoin.edu.pe"],
      vars: EMAIL_PREVIEW_SAMPLES.payment_approved,
    });
  });

  it("refuses more than five addresses before anything is written", async () => {
    signedIn();
    const send = vi.spyOn(container.useCases.emails.sendProof, "run");

    const response = await post("/api/v1/emails/flows/payment_approved/proof", {
      recipients: ["a@x.pe", "b@x.pe", "c@x.pe", "d@x.pe", "e@x.pe", "f@x.pe"],
    });

    expect(response.statusCode).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a template nothing sends yet", async () => {
    signedIn();
    const send = vi.spyOn(container.useCases.emails.sendProof, "run");

    const response = await post("/api/v1/emails/flows/certificate_issued/proof", { recipients: ["a@x.pe"] });

    expect(response.statusCode).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("is not the analyst's: observing never sends anything", async () => {
    vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue({ ...SUPERVISOR, role: "analyst" });
    vi.spyOn(container.edge.rateLimiter, "hit").mockResolvedValue(null);
    const send = vi.spyOn(container.useCases.emails.sendProof, "run");

    const response = await post("/api/v1/emails/flows/payment_approved/proof", { recipients: ["a@x.pe"] });

    expect(response.statusCode).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });
});
