import { execFileSync } from "node:child_process";
import {
  DocumentKindNotFoundError,
  DocumentTemplateDraftMissingError,
  DocumentTemplateHasIssuesError,
  DocumentTemplateNotPublishedError,
  DocumentTemplateVersion,
  LEGAL_IDENTITY,
  PublishDocumentTemplateUseCase,
  SaveDocumentTemplateDraftUseCase,
  Teacher,
  TeacherContract,
  TeacherContractNotFoundError,
  TeacherNotFoundError,
  type DocumentTemplateDraft,
  type IDocumentTemplateRepository,
} from "@ooc/domain";
import { TemplateEngine } from "@ooc/templates";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { DocumentMissingValueError, DocumentPreviewService } from "@/documents/DocumentPreviewService.js";
import { DOCUMENT_KINDS, DocumentTemplateCompiler } from "@/documents/documentKinds.js";
import { frameDocument } from "@/documents/frame.js";
import { teacherContractData, todayInLima } from "@/documents/kinds/teacherContract.js";
import {
  ContractPeriodOutOfOrderError,
  TeacherContractDocumentService,
} from "@/documents/TeacherContractDocumentService.js";
import type { IPdfRenderer } from "@/infra/pdf/WeasyPrintRenderer.js";
import { WeasyPrintRenderer } from "@/infra/pdf/WeasyPrintRenderer.js";
import { FakeAuditLogRepository } from "./fakes/catalog.js";
import { FakeTeacherContractRepository, FakeTeacherRepository } from "./fakes/teacher.js";

/**
 * OOC-123: editable document templates. Drafts may be wrong and are always
 * saved; only a clean draft is published, as an immutable numbered version;
 * the preview runs the real pipeline (engine → frame → WeasyPrint) and writes
 * nothing.
 */

class FakeTemplates implements IDocumentTemplateRepository {
  public readonly drafts = new Map<string, DocumentTemplateDraft>();
  public readonly versions: DocumentTemplateVersion[] = [];

  async findDraft(kind: string) {
    return this.drafts.get(kind) ?? null;
  }
  async saveDraft(draft: DocumentTemplateDraft) {
    this.drafts.set(draft.kind, draft);
    return draft;
  }
  async findPublished(kind: string) {
    return this.versions.filter((v) => v.kind === kind).sort((a, b) => b.version - a.version)[0] ?? null;
  }
  async findVersion(kind: string, id: string) {
    return this.versions.find((v) => v.kind === kind && v.id === id) ?? null;
  }
  async publish(params: { id: string; kind: string; body: string; publishedBy: string }) {
    const version = new DocumentTemplateVersion({
      ...params,
      version: this.versions.filter((v) => v.kind === params.kind).length + 1,
    });
    this.versions.push(version);
    return version;
  }
}

/** Captures the framed HTML instead of making a PDF. */
class CapturingRenderer implements IPdfRenderer {
  public html: string[] = [];
  async render(html: string) {
    this.html.push(html);
    return new TextEncoder().encode("%PDF-fake");
  }
}

const engine = new TemplateEngine();
const compiler = new DocumentTemplateCompiler(engine);
const STARTER = DOCUMENT_KINDS.teacher_contract.starterBody;

const ANA = Teacher.create({
  firstName: "Ana",
  lastName: "Quispe",
  nationalIdType: "CE",
  nationalId: "001234567",
  email: "ana@example.com",
  phone: "+51900000000",
  nationality: "IT",
  country: "PE",
  region: "Lima",
  city: "Lima",
  addressLine: "Av. Siempre Viva 123",
  languages: ["Italiano", "Inglés"],
  availability: [],
});

function setup() {
  const templates = new FakeTemplates();
  const audit = new FakeAuditLogRepository();
  const renderer = new CapturingRenderer();
  return {
    templates,
    audit,
    renderer,
    save: new SaveDocumentTemplateDraftUseCase(templates, compiler),
    publish: new PublishDocumentTemplateUseCase(templates, compiler, audit),
    preview: new DocumentPreviewService(engine, renderer, compiler, templates, new FakeTeacherRepository(ANA)),
  };
}

describe("the teacher contract kind", () => {
  it("starts from a text that passes the check, so a fresh editor is publishable", () => {
    expect(compiler.check("teacher_contract", STARTER)).toEqual([]);
  });

  it("survives its own sanitizer unchanged in meaning", () => {
    expect(compiler.check("teacher_contract", compiler.sanitize(STARTER))).toEqual([]);
  });

  it("fills a teacher file in the words the contract prints", () => {
    const data = teacherContractData(ANA, { startsOn: "2026-11-01", endsOn: "2027-10-31" }, new Date("2026-10-24T03:00:00Z"));
    expect(data.teacher).toMatchObject({
      fullName: "Ana Quispe",
      documentType: "Carné de extranjería",
      nationality: "Italia",
      country: "Perú",
      languages: "Italiano e Inglés",
    });
    expect(data.org).toEqual({ ...LEGAL_IDENTITY });
    // 03:00 UTC on the 24th is still the 23rd in Lima.
    expect(data.issuedOn).toBe("2026-10-23");
  });

  it("dates today in Lima", () => {
    expect(todayInLima(new Date("2026-01-01T04:59:00Z"))).toBe("2025-12-31");
  });
});

describe("DocumentTemplateCompiler.sanitize", () => {
  it("keeps structure, emphasis and alignment", () => {
    const html = '<h1 style="text-align: center">T</h1><p style="text-align: justify"><strong>a</strong> <em>b</em> <u>c</u></p><ul><li>x</li></ul>';
    // The sanitizer writes the style back compactly; the alignment is what stays.
    expect(compiler.sanitize(html)).toBe(html.replace(/text-align: /g, "text-align:"));
  });

  it("drops anything that loads, links, scripts or restyles", () => {
    const html =
      '<p style="color: red; text-align: left" onclick="x()">a<img src="http://169.254.169.254/x"><a href="https://evil.example">b</a><script>alert(1)</script><style>p{}</style><iframe src="x"></iframe></p>';
    expect(compiler.sanitize(html)).toBe('<p style="text-align:left">ab</p>');
  });

  it("leaves placeholders and Liquid tags as text", () => {
    const html = "<p>{{ teacher.fullName }} {% if teacher.region %}{{ teacher.region }}{% endif %}</p>";
    expect(compiler.sanitize(html)).toBe(html);
  });
});

describe("SaveDocumentTemplateDraftUseCase", () => {
  it("saves a wrong draft anyway and says what is wrong", async () => {
    const { save, templates } = setup();

    const result = await save.run({
      actorId: "staff-1",
      kind: "teacher_contract",
      body: "<p>{{ teacher.fulName }}</p><script>x</script>",
    });

    expect(templates.drafts.get("teacher_contract")?.body).toBe("<p>{{ teacher.fulName }}</p>");
    expect(result.issues).toEqual([expect.objectContaining({ code: "unknown_variable", variable: "teacher.fulName" })]);
  });

  it("refuses a kind the code cannot produce", async () => {
    const { save } = setup();
    await expect(save.run({ actorId: "staff-1", kind: "nope", body: "<p>x</p>" })).rejects.toBeInstanceOf(
      DocumentKindNotFoundError,
    );
  });
});

describe("PublishDocumentTemplateUseCase", () => {
  it("publishes a clean draft as version 1, then 2, and audits each", async () => {
    const { save, publish, templates, audit } = setup();

    await save.run({ actorId: "staff-1", kind: "teacher_contract", body: STARTER });
    const first = await publish.run({ actorId: "staff-1", kind: "teacher_contract" });
    await save.run({ actorId: "staff-1", kind: "teacher_contract", body: "<p>{{ teacher.fullName }}</p>" });
    const second = await publish.run({ actorId: "staff-2", kind: "teacher_contract" });

    expect([first.version, second.version]).toEqual([1, 2]);
    expect(templates.versions).toHaveLength(2);
    expect(audit.appended.map((entry) => [entry.action, entry.metadata])).toEqual([
      ["document_template.published", { kind: "teacher_contract", version: 1 }],
      ["document_template.published", { kind: "teacher_contract", version: 2 }],
    ]);
  });

  it("does not publish the same text twice", async () => {
    const { save, publish, templates, audit } = setup();
    await save.run({ actorId: "staff-1", kind: "teacher_contract", body: STARTER });

    const first = await publish.run({ actorId: "staff-1", kind: "teacher_contract" });
    const again = await publish.run({ actorId: "staff-1", kind: "teacher_contract" });

    expect(again.id).toBe(first.id);
    expect(templates.versions).toHaveLength(1);
    expect(audit.appended).toHaveLength(1);
  });

  it("refuses a draft with issues", async () => {
    const { save, publish, templates } = setup();
    await save.run({ actorId: "staff-1", kind: "teacher_contract", body: "<p>{{ nope }}</p>" });

    await expect(publish.run({ actorId: "staff-1", kind: "teacher_contract" })).rejects.toBeInstanceOf(
      DocumentTemplateHasIssuesError,
    );
    expect(templates.versions).toHaveLength(0);
  });

  it("refuses when nothing was written", async () => {
    const { publish } = setup();
    await expect(publish.run({ actorId: "staff-1", kind: "teacher_contract" })).rejects.toBeInstanceOf(
      DocumentTemplateDraftMissingError,
    );
  });
});

describe("DocumentPreviewService", () => {
  it("renders the unsaved text with the sample, inside the frame, writing nothing", async () => {
    const { preview, renderer, templates } = setup();

    await preview.preview({ kind: "teacher_contract", body: "<p>Hola {{ teacher.fullName }}</p>" });

    const html = renderer.html[0]!;
    expect(html).toContain("<p>Hola Ana María Quispe Peña</p>");
    expect(html).toContain(`${LEGAL_IDENTITY.legalName} · RUC ${LEGAL_IDENTITY.ruc}`);
    expect(templates.drafts.size).toBe(0);
  });

  it("falls back to the starter text when nothing was written", async () => {
    const { preview, renderer } = setup();
    await preview.preview({ kind: "teacher_contract" });
    expect(renderer.html[0]).toContain("CONTRATO DE LOCACIÓN DE SERVICIOS");
  });

  it("fills a real teacher's file when one is picked", async () => {
    const { preview, renderer } = setup();
    await preview.preview({ kind: "teacher_contract", body: "<p>{{ teacher.fullName }}, {{ teacher.documentType }}</p>", teacherId: ANA.id });
    expect(renderer.html[0]).toContain("<p>Ana Quispe, Carné de extranjería</p>");
  });

  it("escapes what the record carries", async () => {
    const evil = Object.assign(Object.create(Object.getPrototypeOf(ANA) as object) as Teacher, ANA, {
      firstName: "<script>x</script>",
    });
    const preview = new DocumentPreviewService(
      engine,
      new CapturingRenderer(),
      compiler,
      new FakeTemplates(),
      new FakeTeacherRepository(evil),
    );
    const renderer = (preview as unknown as { renderer: CapturingRenderer }).renderer;
    await preview.preview({ kind: "teacher_contract", body: "<p>{{ teacher.firstName }}</p>", teacherId: evil.id });
    expect(renderer.html[0]).toContain("<p>&lt;script&gt;x&lt;/script&gt;</p>");
  });

  it("answers a code when a printed value is empty for this record", async () => {
    const { preview } = setup();
    const noRegion = Object.assign(Object.create(Object.getPrototypeOf(ANA) as object) as Teacher, ANA, {
      region: null,
    });
    const withEmpty = new DocumentPreviewService(
      engine,
      new CapturingRenderer(),
      compiler,
      new FakeTemplates(),
      new FakeTeacherRepository(noRegion),
    );
    await expect(
      withEmpty.preview({ kind: "teacher_contract", body: "<p>{{ teacher.region }}</p>", teacherId: noRegion.id }),
    ).rejects.toBeInstanceOf(DocumentMissingValueError);
    // The sample has a region, so the same text previews fine without a record.
    await expect(preview.preview({ kind: "teacher_contract", body: "<p>{{ teacher.region }}</p>" })).resolves.toBeDefined();
  });

  it("refuses a text with issues instead of printing blanks", async () => {
    const { preview } = setup();
    await expect(preview.preview({ kind: "teacher_contract", body: "<p>{{ nope }}</p>" })).rejects.toBeInstanceOf(
      DocumentTemplateHasIssuesError,
    );
  });
});

describe("TeacherContractDocumentService", () => {
  function contractSetup() {
    const { templates, audit, renderer, preview } = setup();
    const contracts = new FakeTeacherContractRepository();
    return {
      templates,
      audit,
      renderer,
      contracts,
      contract: new TeacherContractDocumentService(preview, templates, new FakeTeacherRepository(ANA), contracts, audit),
    };
  }
  const PERIOD = { startsOn: "2026-11-01", endsOn: "2027-10-31" };
  const PERIOD_BODY =
    "<p>{{ teacher.fullName }}: {{ contract.startsOn | local_date }} – {{ contract.endsOn | local_date }}</p>";

  it("fills the published version with the teacher and the chosen period, and audits who printed it", async () => {
    const { templates, audit, renderer, contract, contracts } = contractSetup();
    const v1 = await templates.publish({
      id: "11111111-1111-4111-8111-111111111111",
      kind: "teacher_contract",
      body: PERIOD_BODY,
      publishedBy: "u-admin",
    });

    const result = await contract.generate({ actorId: "u-admin", teacherId: ANA.id, ...PERIOD });

    expect(result.templateVersion).toBe(1);
    expect(result.contractId).toBe(contracts.rows[0]!.id);
    expect(renderer.html[0]).toContain("<p>Ana Quispe: 1 de noviembre de 2026 – 31 de octubre de 2027</p>");
    expect(audit.appended).toEqual([
      expect.objectContaining({
        actorId: "u-admin",
        action: "teacher_contract.generated",
        targetId: ANA.id,
        metadata: { contractId: result.contractId, templateVersionId: v1.id, templateVersion: 1 },
      }),
    ]);
  });

  it("records the period it printed, the version and who generated it — never a file (OOC-124)", async () => {
    const { templates, contract, contracts } = contractSetup();
    const v1 = await templates.publish({
      id: "11111111-1111-4111-8111-111111111111",
      kind: "teacher_contract",
      body: STARTER,
      publishedBy: "u",
    });

    await contract.generate({ actorId: "u-admin", teacherId: ANA.id, ...PERIOD });

    expect(contracts.rows).toHaveLength(1);
    expect(contracts.rows[0]).toMatchObject({
      teacherId: ANA.id,
      templateVersionId: v1.id,
      recordedBy: "u-admin",
      file: null,
    });
    expect(contracts.rows[0]!.startsOn.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(contracts.rows[0]!.endsOn.toISOString()).toBe("2027-10-31T00:00:00.000Z");
  });

  it("records nothing when the PDF does not come out", async () => {
    const { templates, audit, contracts } = contractSetup();
    await templates.publish({ id: "11111111-1111-4111-8111-111111111111", kind: "teacher_contract", body: STARTER, publishedBy: "u" });
    const broken = new DocumentPreviewService(
      engine,
      {
        render: () => Promise.reject(new Error("weasyprint died")),
      },
      compiler,
      templates,
      new FakeTeacherRepository(ANA),
    );
    const contract = new TeacherContractDocumentService(broken, templates, new FakeTeacherRepository(ANA), contracts, audit);

    await expect(contract.generate({ actorId: "u", teacherId: ANA.id, ...PERIOD })).rejects.toThrow();
    expect(contracts.rows).toEqual([]);
    expect(audit.appended).toEqual([]);
  });

  it("prints from the published version, never the draft in progress", async () => {
    const { templates, renderer, contract } = contractSetup();
    await templates.publish({ id: "11111111-1111-4111-8111-111111111111", kind: "teacher_contract", body: "<p>aprobado</p>", publishedBy: "u" });
    await templates.saveDraft({ kind: "teacher_contract", body: "<p>borrador</p>", updatedBy: "u", updatedAt: new Date() });

    await contract.generate({ actorId: "u", teacherId: ANA.id, ...PERIOD });
    expect(renderer.html[0]).toContain("<p>aprobado</p>");
    expect(renderer.html[0]).not.toContain("borrador");
  });

  it("refuses while nothing has been published, recording nothing", async () => {
    const { templates, audit, contract, contracts } = contractSetup();
    await templates.saveDraft({ kind: "teacher_contract", body: STARTER, updatedBy: "u", updatedAt: new Date() });
    await expect(contract.generate({ actorId: "u", teacherId: ANA.id, ...PERIOD })).rejects.toBeInstanceOf(
      DocumentTemplateNotPublishedError,
    );
    expect(audit.appended).toEqual([]);
    expect(contracts.rows).toEqual([]);
  });

  it("refuses a period that ends on or before it starts, recording nothing", async () => {
    const { templates, contract, contracts } = contractSetup();
    await templates.publish({ id: "11111111-1111-4111-8111-111111111111", kind: "teacher_contract", body: STARTER, publishedBy: "u" });
    for (const endsOn of ["2026-11-01", "2026-10-31"]) {
      await expect(
        contract.generate({ actorId: "u", teacherId: ANA.id, startsOn: "2026-11-01", endsOn }),
      ).rejects.toBeInstanceOf(ContractPeriodOutOfOrderError);
    }
    expect(contracts.rows).toEqual([]);
  });

  it("answers not found for an unknown teacher", async () => {
    const { templates, contract } = contractSetup();
    await templates.publish({ id: "11111111-1111-4111-8111-111111111111", kind: "teacher_contract", body: STARTER, publishedBy: "u" });
    await expect(
      contract.generate({ actorId: "u", teacherId: "00000000-0000-4000-8000-000000000000", ...PERIOD }),
    ).rejects.toBeInstanceOf(TeacherNotFoundError);
  });

  describe("regenerate", () => {
    it("prints a recorded contract again from its own version and period, after a newer one is published", async () => {
      const { templates, audit, renderer, contract } = contractSetup();
      const v1 = await templates.publish({
        id: "11111111-1111-4111-8111-111111111111",
        kind: "teacher_contract",
        body: PERIOD_BODY,
        publishedBy: "u",
      });
      const { contractId } = await contract.generate({ actorId: "u", teacherId: ANA.id, ...PERIOD });
      await templates.publish({ id: "22222222-2222-4222-8222-222222222222", kind: "teacher_contract", body: "<p>v2</p>", publishedBy: "u" });

      const result = await contract.regenerate({ actorId: "u-analyst", teacherId: ANA.id, contractId });

      expect(result.templateVersion).toBe(1);
      expect(renderer.html[1]).toContain("<p>Ana Quispe: 1 de noviembre de 2026 – 31 de octubre de 2027</p>");
      expect(renderer.html[1]).not.toContain("v2");
      expect(audit.appended.at(-1)).toMatchObject({
        actorId: "u-analyst",
        action: "teacher_contract.regenerated",
        targetId: ANA.id,
        metadata: { contractId, templateVersionId: v1.id, templateVersion: 1 },
      });
    });

    it("answers not found for a contract of another teacher", async () => {
      const { templates, contract } = contractSetup();
      await templates.publish({ id: "11111111-1111-4111-8111-111111111111", kind: "teacher_contract", body: STARTER, publishedBy: "u" });
      const { contractId } = await contract.generate({ actorId: "u", teacherId: ANA.id, ...PERIOD });

      await expect(
        contract.regenerate({ actorId: "u", teacherId: "00000000-0000-4000-8000-000000000000", contractId }),
      ).rejects.toBeInstanceOf(TeacherContractNotFoundError);
    });

    it("answers not found for a contract filed as a PDF — it opens by its file", async () => {
      const { contract, contracts, renderer } = contractSetup();
      const filed = await contracts.create(
        new TeacherContract({
          id: "018f2b5c-0000-7000-8000-0000000000aa",
          teacherId: ANA.id,
          file: { objectKey: "teacher-contracts/x/y", fileName: "contrato.pdf", fileSizeBytes: 10 },
          templateVersionId: null,
          startsOn: new Date("2026-03-01T00:00:00Z"),
          endsOn: new Date("2026-12-31T00:00:00Z"),
          recordedBy: "u",
        }),
      );

      await expect(
        contract.regenerate({ actorId: "u", teacherId: ANA.id, contractId: filed.id }),
      ).rejects.toBeInstanceOf(TeacherContractNotFoundError);
      expect(renderer.html).toEqual([]);
    });
  });
});

function hasWeasyPrint(): boolean {
  try {
    execFileSync("weasyprint", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * The real renderer. WeasyPrint is installed in the API image and in the CI
 * job that runs this suite; a laptop without it skips only this block.
 */
describe.runIf(hasWeasyPrint() || process.env.CI === "true")("WeasyPrintRenderer", () => {
  it("prints the starter contract as an A4 PDF that opens", async () => {
    const data = DOCUMENT_KINDS.teacher_contract.kind.sample;
    const html = await engine.render(DOCUMENT_KINDS.teacher_contract.kind, STARTER, data, { locale: "es-PE" });

    const pdf = await new WeasyPrintRenderer().render(frameDocument(html));

    const document = await PDFDocument.load(pdf);
    expect(document.getPageCount()).toBeGreaterThanOrEqual(1);
    const { width, height } = document.getPage(0).getSize();
    // A4 is 595 × 842 points.
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
  }, 30_000);

  it("answers unavailable when the binary is missing", async () => {
    await expect(new WeasyPrintRenderer({ bin: "weasyprint-does-not-exist" }).render("<p>x</p>")).rejects.toMatchObject({
      reason: "unavailable",
    });
  });
});
