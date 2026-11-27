import {
  EDITABLE_EMAIL_KEYS,
  GetEmailTemplateDraftCopyUseCase,
  LocaleSchema,
  PublishEmailTemplateUseCase,
  SaveEmailTemplateDraftUseCase,
  type AuditLogEntry,
  type AuthenticatedUser,
  type EditableEmailKey,
  type EmailCopy,
  type EmailTemplateContent,
  type EmailTemplateDraft,
  type EmailTemplateVersion,
  type IEmailTemplateRepository,
} from "@ooc/domain";
import { repositoryEmailContent } from "@ooc/notifications";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { emailTemplateChecker } from "@/http/email/emailTemplateChecker.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/**
 * OOC-60: an automatic e-mail's words edited in the backoffice. The check
 * that stands between a draft and the students (every language, the
 * repository's blocks, no placeholder the e-mail has no value for), the
 * draft → version rule, and the routes' doors.
 */

const clone = <T>(value: T): T => structuredClone(value);

function withEsPE(key: EditableEmailKey, change: (copy: EmailCopy) => void): EmailTemplateContent {
  const content = clone(repositoryEmailContent(key));
  change(content["es-PE"]);
  return content;
}

const codes = (key: EditableEmailKey, content: EmailTemplateContent) =>
  emailTemplateChecker.check(key, content).issues.map((issue) => issue.code);

describe("the check of edited words", () => {
  it.each(EDITABLE_EMAIL_KEYS)("passes the repository's own words for %s, with nothing to look at", (key) => {
    expect(emailTemplateChecker.check(key, repositoryEmailContent(key))).toEqual({ issues: [], warnings: [] });
  });

  it("refuses a placeholder the e-mail has no value for, saying where", () => {
    const content = withEsPE("payment_approved", (copy) => {
      copy.paragraphs[1] = "Las clases empiezan el {startDate}.";
    });

    expect(emailTemplateChecker.check("payment_approved", content).issues).toEqual([
      { code: "unknown_placeholder", locale: "es-PE", field: "paragraphs", index: 1, placeholder: "startDate" },
    ]);
  });

  it("refuses a missing language", () => {
    const content = clone(repositoryEmailContent("payment_approved")) as EmailTemplateContent;
    delete content.en;

    expect(emailTemplateChecker.check("payment_approved", content).issues).toEqual([
      { code: "locale_missing", locale: "en" },
    ]);
  });

  it("refuses an empty subject, an empty paragraph and half a placeholder", () => {
    const content = withEsPE("payment_approved", (copy) => {
      copy.subject = "  ";
      copy.paragraphs = ["", "Hola {studentName"];
    });

    expect(codes("payment_approved", content)).toEqual(["field_empty", "field_empty", "malformed_placeholder"]);
  });

  it("keeps the repository's blocks: no button where the code puts no link, and a label where it does", () => {
    const extra = withEsPE("payment_approved", (copy) => {
      copy.action = "Ver";
    });
    const missing = withEsPE("portal_credentials", (copy) => {
      copy.action = "";
    });

    expect(codes("payment_approved", extra)).toEqual(["field_not_allowed"]);
    expect(codes("portal_credentials", missing)).toEqual(["field_empty"]);
  });

  it("keeps a lot e-mail's list where it is, and its line to the entry's fields", () => {
    const gone = withEsPE("lot_payment_approved", (copy) => {
      copy.paragraphs = copy.paragraphs.filter((paragraph) => paragraph !== "{items}");
    });
    const inline = withEsPE("lot_payment_approved", (copy) => {
      copy.paragraphs[0] = `${copy.paragraphs[0]} {items}`;
    });
    const wrongScope = withEsPE("lot_payment_approved", (copy) => {
      copy.item = "{recipientName} en {courseName}";
    });

    expect(codes("lot_payment_approved", gone)).toEqual(["items_paragraph_missing"]);
    expect(codes("lot_payment_approved", inline)).toEqual(["items_inline"]);
    expect(codes("lot_payment_approved", wrongScope)).toEqual(["unknown_placeholder"]);
  });

  it("keeps every code's label, and no placeholder inside one", () => {
    const content = withEsPE("complaint_filed", (copy) => {
      copy.values!.kind!.claim = "";
      copy.values!.kind!.grievance = "{kind}";
    });

    expect(codes("complaint_filed", content)).toEqual(["field_empty", "unknown_placeholder"]);
  });

  it("lets a placeholder go, as a warning and never a stop", () => {
    const content = withEsPE("payment_approved", (copy) => {
      copy.paragraphs = ["¡Tu matrícula está confirmada!"];
    });

    const check = emailTemplateChecker.check("payment_approved", content);
    expect(check.issues).toEqual([]);
    expect(check.warnings.map((warning) => warning.placeholder).sort()).toEqual(["studentName"]);
  });
});

class MemoryTemplates implements IEmailTemplateRepository {
  draft: EmailTemplateDraft | null = null;
  versions: EmailTemplateVersion[] = [];

  async findDraft() {
    return this.draft;
  }
  async saveDraft(draft: EmailTemplateDraft) {
    this.draft = draft;
    return draft;
  }
  async findPublished() {
    return this.versions[0] ?? null;
  }
  async listVersions() {
    return this.versions;
  }
  async publish(params: Parameters<IEmailTemplateRepository["publish"]>[0]) {
    const version: EmailTemplateVersion = {
      ...params,
      version: this.versions.length + 1,
      publishedByName: null,
      createdAt: new Date(),
    };
    this.versions.unshift(version);
    return version;
  }
}

class RecordingAudit {
  entries: AuditLogEntry[] = [];
  async append(entry: AuditLogEntry) {
    this.entries.push(entry);
  }
}

describe("draft → version", () => {
  it("saves a wrong draft and says what is wrong", async () => {
    const templates = new MemoryTemplates();
    const content = withEsPE("payment_approved", (copy) => {
      copy.subject = "{nope}";
    });

    const draft = await new SaveEmailTemplateDraftUseCase(templates, emailTemplateChecker).run({
      actorId: "u-1",
      templateKey: "payment_approved",
      content,
    });

    expect(templates.draft?.content).toEqual(content);
    expect(draft.issues.map((issue) => issue.code)).toEqual(["unknown_placeholder"]);
  });

  it("refuses to publish a draft with issues, and a template that is not editable", async () => {
    const templates = new MemoryTemplates();
    templates.draft = {
      templateKey: "payment_approved",
      content: withEsPE("payment_approved", (copy) => {
        copy.subject = "{nope}";
      }),
      updatedBy: "u-1",
      updatedAt: new Date(),
    };
    const publish = new PublishEmailTemplateUseCase(templates, emailTemplateChecker, new RecordingAudit());

    await expect(publish.run({ actorId: "u-1", templateKey: "payment_approved" })).rejects.toMatchObject({
      reason: "email_template.has_issues",
    });
    await expect(publish.run({ actorId: "u-1", templateKey: "staff_mfa_code" })).rejects.toMatchObject({
      reason: "email_template.not_editable",
      status: 404,
    });
    expect(templates.versions).toHaveLength(0);
  });

  it("publishes the next version once, audited, and the same words again write nothing", async () => {
    const templates = new MemoryTemplates();
    const audit = new RecordingAudit();
    const content = withEsPE("payment_approved", (copy) => {
      copy.subject = "¡Listo, {studentName}!";
    });
    templates.draft = { templateKey: "payment_approved", content, updatedBy: "u-1", updatedAt: new Date() };
    const publish = new PublishEmailTemplateUseCase(templates, emailTemplateChecker, audit);

    const first = await publish.run({ actorId: "u-1", templateKey: "payment_approved" });
    // Same words, keys in another order: still the same.
    templates.draft = { ...templates.draft, content: Object.fromEntries(Object.entries(content).reverse()) };
    const again = await publish.run({ actorId: "u-1", templateKey: "payment_approved" });

    expect(first).toMatchObject({ published: true, version: { version: 1 } });
    expect(again).toMatchObject({ published: false, version: { version: 1 } });
    expect(audit.entries).toEqual([
      expect.objectContaining({
        action: "email_template.published",
        targetId: first.version.id,
        metadata: { template: "payment_approved", version: 1 },
      }),
    ]);
    expect(first.version.repositoryVersion).toBe(emailTemplateChecker.repositoryVersion("payment_approved"));
  });

  it("hands a proof the draft's words in one language, only when the draft passes", async () => {
    const templates = new MemoryTemplates();
    const useCase = new GetEmailTemplateDraftCopyUseCase(templates, emailTemplateChecker);
    await expect(useCase.run({ templateKey: "payment_approved", locale: "en" })).rejects.toMatchObject({
      reason: "email_template.draft_missing",
    });

    const content = withEsPE("payment_approved", (copy) => {
      copy.subject = "Hola";
    });
    templates.draft = { templateKey: "payment_approved", content, updatedBy: "u-1", updatedAt: new Date() };
    await expect(useCase.run({ templateKey: "payment_approved", locale: "es-PE" })).resolves.toEqual(content["es-PE"]);
  });
});

function staff(role: AuthenticatedUser["role"]): AuthenticatedUser {
  return { id: `u-${role}`, email: `${role}@example.com`, name: role, role, twoFactorEnabled: true };
}

describe("the routes", () => {
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

  function as(role: AuthenticatedUser["role"]) {
    vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(staff(role));
    vi.spyOn(container.edge.rateLimiter, "hit").mockResolvedValue(null);
  }

  const inject = (method: "GET" | "PUT" | "POST", url: string, payload?: object) =>
    app.inject({ method, url, payload, cookies: { [SESSION_COOKIE_NAME]: "token" } });

  it.each(["analyst", "enrollment_supervisor", "billing"] as const)("refuses %s writing a draft or publishing", async (role) => {
    as(role);
    const save = vi.spyOn(container.useCases.emails.saveTemplateDraft, "run");
    const publish = vi.spyOn(container.useCases.emails.publishTemplate, "run");

    const content = repositoryEmailContent("payment_approved");
    expect((await inject("PUT", "/api/v1/emails/templates/payment_approved/draft", { content })).statusCode).toBe(403);
    expect((await inject("POST", "/api/v1/emails/templates/payment_approved/publish")).statusCode).toBe(403);
    expect(save).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("lets admin save a draft", async () => {
    as("admin");
    const run = vi.spyOn(container.useCases.emails.saveTemplateDraft, "run").mockResolvedValue({
      templateKey: "payment_approved",
      content: repositoryEmailContent("payment_approved"),
      updatedBy: "u-admin",
      updatedAt: new Date("2026-11-27T12:00:00Z"),
      issues: [],
      warnings: [],
    });

    const response = await inject("PUT", "/api/v1/emails/templates/payment_approved/draft", {
      content: repositoryEmailContent("payment_approved"),
    });

    expect(response.statusCode).toBe(200);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ actorId: "u-admin", templateKey: "payment_approved" }));
  });

  it("does not open a staff or security e-mail for editing", async () => {
    as("admin");
    for (const key of ["staff_mfa_code", "staff_password_reset", "portal_password_reset", "email_verification_code"]) {
      expect((await inject("GET", `/api/v1/emails/templates/${key}`)).statusCode).toBe(400);
    }
  });

  it("previews unsaved words over the sample data, and refuses words that do not pass", async () => {
    as("enrollment_supervisor");
    const content = withEsPE("payment_approved", (copy) => {
      copy.subject = "¡Bienvenida, {studentName}!";
    });

    const ok = await inject("POST", "/api/v1/emails/templates/payment_approved/preview", { locale: "es-PE", content });
    const bad = await inject("POST", "/api/v1/emails/templates/payment_approved/preview", {
      locale: "es-PE",
      content: withEsPE("payment_approved", (copy) => {
        copy.subject = "{nope}";
      }),
    });

    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ subject: string }>().subject).toBe("¡Bienvenida, María Fernanda Quispe Rojas!");
    expect(bad.statusCode).toBe(422);
    expect(bad.json<{ issues: { code: string }[] }>().issues.map((issue) => issue.code)).toEqual(["unknown_placeholder"]);
  });

  it("refuses HTML-looking words nowhere, and escapes them in the e-mail", async () => {
    as("admin");
    const content = withEsPE("payment_approved", (copy) => {
      copy.paragraphs = ['<a href="https://evil.example">{studentName}</a>'];
    });

    const response = await inject("POST", "/api/v1/emails/templates/payment_approved/preview", { locale: "es-PE", content });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ html: string }>().html).not.toContain('<a href="https://evil.example"');
    expect(response.json<{ html: string }>().html).toContain("&lt;a href=");
  });

  it("sends a proof of the draft with the draft's words", async () => {
    as("admin");
    const copy = repositoryEmailContent("payment_approved")["pt-BR"];
    vi.spyOn(container.useCases.emails.templateDraftCopy, "run").mockResolvedValue(copy);
    const send = vi.spyOn(container.useCases.emails.sendProof, "run").mockResolvedValue({ outboxIds: ["o-1"] });

    const response = await inject("POST", "/api/v1/emails/flows/payment_approved/proof", {
      locale: "pt-BR",
      recipients: ["qa@onlyonecoin.edu.pe"],
      draft: true,
    });

    expect(response.statusCode).toBe(202);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ locale: "pt-BR", copy }));
  });

  it("covers every language the platform ships", () => {
    expect(Object.keys(repositoryEmailContent("payment_approved")).sort()).toEqual([...LocaleSchema.options].sort());
  });
});
