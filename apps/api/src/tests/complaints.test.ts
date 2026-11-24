import {
  ComplaintFormSchema,
  FileComplaintUseCase,
  LEGAL_IDENTITY,
  complaintCodeOf,
  parseSolesToCents,
  toFieldErrors,
  type EmailNotification,
  type FiledComplaint,
  type IComplaintRepository,
  type NewComplaint,
} from "@ooc/domain";
import { renderEmail } from "@ooc/notifications";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";

/**
 * The complaints book's public form (OOC-63): the form's rules, the copy the
 * consumer receives, and the route's guards. No database: the repository is
 * a fake here; the SQL is the migration's CHECKs and `privileges.test.ts`.
 */

const KEY = "018f2b5c-9100-7000-8000-00000000c0a1";

const adultForm = () => ({
  kind: "claim",
  consumer: {
    firstName: " Ana  María ",
    lastName: "Pérez",
    secondLastName: "",
    nationalIdType: "DNI",
    nationalId: "12.345.678",
    phone: "987 654 321",
    email: "Ana@Hotmail.com",
    department: "Lima",
    province: "Lima",
    district: "Miraflores",
    address: "Av. Larco 123",
    addressReference: "",
    isMinor: false,
  },
  guardian: null,
  goodType: "service",
  amountCents: 6990,
  description: "Inglés Básico",
  purchasedOn: "2026-11-02",
  detail: "  No recibí el acceso.\nEscribí dos veces.  ",
  request: "Que me den el acceso.",
  truthfulnessAccepted: true,
  privacyAccepted: true,
});

const minorForm = () => ({
  ...adultForm(),
  consumer: { ...adultForm().consumer, isMinor: true },
  guardian: { firstName: "Rosa", lastName: "Rojas", nationalIdType: "DNI", nationalId: "41234567" },
});

describe("ComplaintFormSchema", () => {
  it("normalizes like the student record: names, document, e-mail; empty optionals are null", () => {
    const form = ComplaintFormSchema.parse(adultForm());
    expect(form.consumer.firstName).toBe("Ana María");
    expect(form.consumer.nationalId).toBe("12345678");
    expect(form.consumer.email).toBe("ana@hotmail.com");
    expect(form.consumer.secondLastName).toBeNull();
    expect(form.consumer.addressReference).toBeNull();
    // Long text keeps the person's line breaks; only the ends are trimmed.
    expect(form.detail).toBe("No recibí el acceso.\nEscribí dos veces.");
  });

  it("takes an e-mail of any provider (the Gmail rule is the student's)", () => {
    expect(ComplaintFormSchema.safeParse(adultForm()).success).toBe(true);
  });

  it("asks for the guardian exactly when the consumer is a minor", () => {
    expect(ComplaintFormSchema.safeParse(minorForm()).success).toBe(true);

    const noGuardian = ComplaintFormSchema.safeParse({ ...minorForm(), guardian: null });
    expect(noGuardian.success).toBe(false);
    expect(toFieldErrors(noGuardian.error!.issues)).toContainEqual({ path: "guardian", code: "required" });

    const adultWithGuardian = ComplaintFormSchema.safeParse({ ...adultForm(), guardian: minorForm().guardian });
    expect(toFieldErrors(adultWithGuardian.error!.issues)).toContainEqual({ path: "guardian", code: "invalid" });
  });

  it("refuses a sheet without the sworn statement or the privacy notice", () => {
    const result = ComplaintFormSchema.safeParse({ ...adultForm(), truthfulnessAccepted: false, privacyAccepted: false });
    expect(toFieldErrors(result.error!.issues)).toEqual(
      expect.arrayContaining([
        { path: "truthfulnessAccepted", code: "required" },
        { path: "privacyAccepted", code: "required" },
      ]),
    );
  });

  it("checks the document against its type, and the purchase day is a real day", () => {
    const result = ComplaintFormSchema.safeParse({
      ...adultForm(),
      consumer: { ...adultForm().consumer, nationalId: "123" },
      purchasedOn: "2026-02-30",
    });
    expect(toFieldErrors(result.error!.issues)).toEqual(
      expect.arrayContaining([
        { path: "consumer.nationalId", code: "national_id_format" },
        { path: "purchasedOn", code: "invalid" },
      ]),
    );
  });

  it("takes the amount and the purchase day as optional", () => {
    expect(ComplaintFormSchema.safeParse({ ...adultForm(), amountCents: null, purchasedOn: null }).success).toBe(true);
    expect(ComplaintFormSchema.safeParse({ ...adultForm(), amountCents: 12.5 }).success).toBe(false);
  });
});

describe("parseSolesToCents", () => {
  it.each([
    ["80", 8000],
    ["69.90", 6990],
    ["69,9", 6990],
    ["S/ 1,250.00", 125000],
    ["1250", 125000],
    ["S/.25", 2500],
  ])("reads %s as %i cents", (typed, cents) => {
    expect(parseSolesToCents(typed)).toBe(cents);
  });

  it("is null when empty and invalid when it is not an amount", () => {
    expect(parseSolesToCents("  ")).toBeNull();
    expect(parseSolesToCents("abc")).toBe("invalid");
    expect(parseSolesToCents("-5")).toBe("invalid");
    expect(parseSolesToCents("1.2.3")).toBe("invalid");
  });
});

describe("complaintCodeOf", () => {
  it("is the Lima year and the sequence, at least six digits, never cut", () => {
    expect(complaintCodeOf(2026, 123)).toBe("2026-000123");
    expect(complaintCodeOf(2027, 1234567)).toBe("2027-1234567");
  });
});

/** Keeps what the use case hands it; the e-mails are built as the repository would. */
function fakeRepository(): IComplaintRepository & { filed: NewComplaint[]; emails: EmailNotification[] } {
  const filed: NewComplaint[] = [];
  const emails: EmailNotification[] = [];
  return {
    filed,
    emails,
    findByIdempotencyKey: async () => null,
    file: async (complaint, build) => {
      filed.push(complaint);
      const sheet: FiledComplaint = { id: "c1", code: "2026-000007", filedAt: new Date("2026-11-24T15:30:00.000Z") };
      emails.push(...build(sheet));
      return sheet;
    },
  };
}

describe("FileComplaintUseCase", () => {
  it("freezes the supplier from LEGAL_IDENTITY and stamps the privacy notice version and the IP", async () => {
    const repository = fakeRepository();
    await new FileComplaintUseCase(repository).run({
      form: ComplaintFormSchema.parse(adultForm()),
      locale: "es-PE",
      ip: "203.0.113.9",
      idempotencyKey: KEY,
    });

    const [sheet] = repository.filed;
    expect(sheet!.supplier).toEqual({ legalName: LEGAL_IDENTITY.legalName, ruc: LEGAL_IDENTITY.ruc, address: LEGAL_IDENTITY.address });
    expect(sheet!.ip).toBe("203.0.113.9");
    expect(sheet!.privacyNoticeVersion).toMatch(/\S/);
  });

  it("sends the consumer one copy, keyed by the sheet, in the form's language", async () => {
    const repository = fakeRepository();
    await new FileComplaintUseCase(repository).run({
      form: ComplaintFormSchema.parse(minorForm()),
      locale: "pt-BR",
      ip: "203.0.113.9",
      idempotencyKey: KEY,
    });

    expect(repository.emails).toHaveLength(1);
    const [email] = repository.emails;
    expect(email).toMatchObject({ templateKey: "complaint_filed", to: "ana@hotmail.com", locale: "pt-BR", dedupeKey: "complaint_filed:c1" });
  });
});

describe("complaint_filed", () => {
  async function copyOf(form: unknown, locale: "es-PE" | "pt-BR" | "en" = "es-PE") {
    const repository = fakeRepository();
    await new FileComplaintUseCase(repository).run({
      form: ComplaintFormSchema.parse(form),
      locale,
      ip: "203.0.113.9",
      idempotencyKey: KEY,
    });
    const email = repository.emails[0]!;
    return renderEmail({ to: email.to, templateKey: email.templateKey, locale: email.locale, vars: email.vars } as never);
  }

  it("labels the codes and carries the sheet's number, the supplier and the guardian", async () => {
    const { subject, text } = await copyOf(minorForm());
    expect(subject).toContain("2026-000007");
    expect(text).toContain("reclamación");
    expect(text).toContain("servicio");
    expect(text).toContain(`RUC ${LEGAL_IDENTITY.ruc}`);
    expect(text).toContain("Rosa Rojas, DNI 41234567");
    expect(text).not.toContain("claim");
  });

  it("leaves out the guardian's paragraph for an adult and says 'not given' for an empty field", async () => {
    const { text } = await copyOf({ ...adultForm(), amountCents: null, purchasedOn: null }, "en");
    expect(text).not.toContain("Parent or guardian");
    expect(text).toContain("Amount claimed: not given");
    expect(text).toContain("Purchase date: not given");
  });

  it("prints the purchase day as typed, never the day before (Lima is UTC-5)", async () => {
    const { text } = await copyOf(adultForm());
    expect(text).toContain("2 de noviembre de 2026");
  });

  it("escapes what the consumer wrote", async () => {
    const { html } = await copyOf({ ...adultForm(), detail: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("POST /public/complaints", () => {
  let app: FastifyInstance;
  const URL = "/api/v1/public/complaints";
  const body = (complaint: unknown = adultForm()) => ({ captchaToken: "token", idempotencyKey: KEY, locale: "es-PE", complaint });

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("files the sheet and answers its number", async () => {
    vi.spyOn(container.edge.captcha, "verify").mockResolvedValue("passed");
    vi.spyOn(container.useCases.complaint.file, "findFiled").mockResolvedValue(null);
    const run = vi
      .spyOn(container.useCases.complaint.file, "run")
      .mockResolvedValue({ id: "c1", code: "2026-000007", filedAt: new Date("2026-11-24T15:30:00.000Z") });

    const response = await app.inject({ method: "POST", url: URL, payload: body() });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ code: "2026-000007", filedAt: "2026-11-24T15:30:00.000Z" });
    expect(run.mock.calls[0]![0]).toMatchObject({ locale: "es-PE", idempotencyKey: KEY });
  });

  it("answers a resend of a filed sheet with its number, without spending a captcha", async () => {
    const verify = vi.spyOn(container.edge.captcha, "verify");
    vi.spyOn(container.useCases.complaint.file, "findFiled").mockResolvedValue({
      id: "c1",
      code: "2026-000007",
      filedAt: new Date("2026-11-24T15:30:00.000Z"),
    });
    const run = vi.spyOn(container.useCases.complaint.file, "run");

    const response = await app.inject({ method: "POST", url: URL, payload: body() });

    expect(response.statusCode).toBe(201);
    expect(response.json().code).toBe("2026-000007");
    expect(verify).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses a refused captcha with 422 and an unreachable one with 503, filing nothing", async () => {
    vi.spyOn(container.useCases.complaint.file, "findFiled").mockResolvedValue(null);
    const run = vi.spyOn(container.useCases.complaint.file, "run");

    vi.spyOn(container.edge.captcha, "verify").mockResolvedValueOnce("failed").mockResolvedValueOnce("unavailable");
    const refused = await app.inject({ method: "POST", url: URL, payload: body() });
    const unavailable = await app.inject({ method: "POST", url: URL, payload: body() });

    expect(refused.statusCode).toBe(422);
    expect(refused.json().reason).toBe("captcha.failed");
    expect(unavailable.statusCode).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });

  it("names each refused field under `complaint.`", async () => {
    const response = await app.inject({ method: "POST", url: URL, payload: body({ ...minorForm(), guardian: null }) });
    expect(response.statusCode).toBe(400);
    expect(response.json().fields).toContainEqual({ path: "complaint.guardian", code: "required" });
  });
});
