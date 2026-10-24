import {
  InvalidFieldsError,
  OpenTeacherContractUseCase,
  Teacher,
  TeacherContract,
  TeacherContractNotFoundError,
  type CreateTeacherDTO,
} from "@ooc/domain";
import { describe, expect, it } from "vitest";
import { contentDisposition } from "@/infra/storage/TigrisTeacherContractStorage.js";
import { FakeAuditLogRepository } from "./fakes/catalog.js";
import { FakeTeacherContractRepository, FakeTeacherContractStorage } from "./fakes/teacher.js";

/**
 * OOC-124: a contract is recorded as the period it covers and the template
 * version it was generated from — nothing is uploaded. The contracts filed as
 * a PDF under OOC-81 still open through a five-minute link, and every opening
 * is in the audit log. Generating is in `document-templates.test.ts`.
 */

const ANA: CreateTeacherDTO = {
  firstName: "Ana",
  lastName: "Quispe",
  nationalIdType: "DNI",
  nationalId: "12345678",
  email: "ana@example.com",
  phone: "+51900000000",
  nationality: "PE",
  country: "PE",
  region: "Lima",
  city: "Lima",
  addressLine: "Av. Siempre Viva 123",
  languages: ["Italiano"],
  availability: [],
};

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const FILED_ID = "018f2b5c-0000-7000-8000-0000000000aa";
const OTHER_TEACHER = "018f2b5c-0000-7000-8000-0000000000bb";

function setup() {
  const teacher = Teacher.create(ANA);
  const contracts = new FakeTeacherContractRepository();
  const storage = new FakeTeacherContractStorage();
  const audit = new FakeAuditLogRepository();
  const key = `teacher-contracts/${teacher.id}/${FILED_ID}`;
  // A contract filed under OOC-81, the way the row reads back.
  const filed = new TeacherContract({
    id: FILED_ID,
    teacherId: teacher.id,
    file: { objectKey: key, fileName: "Contrato Ana Quispe 2026.pdf", fileSizeBytes: 2048 },
    templateVersionId: null,
    startsOn: new Date("2026-03-01T00:00:00Z"),
    endsOn: new Date("2026-12-31T00:00:00Z"),
    recordedBy: "staff-1",
  });
  return { teacher, contracts, storage, audit, key, filed, open: new OpenTeacherContractUseCase(contracts, storage, audit) };
}

describe("TeacherContract.record", () => {
  it("records the period and the template version, with no file", () => {
    const contract = TeacherContract.record({
      teacherId: "018f2b5c-0000-7000-8000-000000000001",
      templateVersionId: VERSION_ID,
      recordedBy: "staff-1",
      period: { startsOn: "2026-03-01", endsOn: "2026-12-31" },
    });

    expect(contract).toMatchObject({ file: null, templateVersionId: VERSION_ID, recordedBy: "staff-1" });
    expect(contract.startsOn.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(contract.endsOn.toISOString()).toBe("2026-12-31T00:00:00.000Z");
  });

  it("refuses a period that ends before it starts, or a day that does not exist", () => {
    const record = (startsOn: string, endsOn: string) =>
      TeacherContract.record({
        teacherId: "018f2b5c-0000-7000-8000-000000000001",
        templateVersionId: VERSION_ID,
        recordedBy: "staff-1",
        period: { startsOn, endsOn },
      });

    expect(() => record("2026-12-31", "2026-03-01")).toThrow(InvalidFieldsError);
    expect(() => record("2026-12-31", "2026-03-01")).toThrow(
      expect.objectContaining({ fields: [{ path: "contract.endsOn", code: "invalid" }] }),
    );
    expect(() => record("", "2026-02-30")).toThrow(
      expect.objectContaining({
        fields: expect.arrayContaining([
          { path: "contract.startsOn", code: "invalid" },
          { path: "contract.endsOn", code: "invalid" },
        ]),
      }),
    );
  });
});

describe("OpenTeacherContractUseCase", () => {
  it("signs a five-minute link to a filed contract under its name and audits the opening", async () => {
    const { open, contracts, storage, audit, teacher, key, filed } = setup();
    await contracts.create(filed);

    const result = await open.run({ actorId: "staff-2", teacherId: teacher.id, contractId: FILED_ID });

    expect(result.url).toContain(key);
    expect(storage.downloads).toEqual([
      { objectKey: key, fileName: "Contrato Ana Quispe 2026.pdf", expiresInSeconds: 300 },
    ]);
    expect(audit.appended).toEqual([
      expect.objectContaining({
        actorId: "staff-2",
        action: "teacher.contract_viewed",
        targetId: teacher.id,
        metadata: { contractId: FILED_ID },
      }),
    ]);
  });

  it("answers 404 for a contract of another teacher, without signing anything", async () => {
    const { open, contracts, storage, audit, filed } = setup();
    await contracts.create(filed);

    await expect(
      open.run({ actorId: "staff-2", teacherId: OTHER_TEACHER, contractId: FILED_ID }),
    ).rejects.toBeInstanceOf(TeacherContractNotFoundError);
    expect(storage.downloads).toHaveLength(0);
    expect(audit.appended).toHaveLength(0);
  });

  it("answers 404 for a generated contract — there is no file to open", async () => {
    const { open, contracts, storage, teacher } = setup();
    const generated = await contracts.create(
      TeacherContract.record({
        teacherId: teacher.id,
        templateVersionId: VERSION_ID,
        recordedBy: "staff-1",
        period: { startsOn: "2026-03-01", endsOn: "2026-12-31" },
      }),
    );

    await expect(
      open.run({ actorId: "staff-2", teacherId: teacher.id, contractId: generated.id }),
    ).rejects.toBeInstanceOf(TeacherContractNotFoundError);
    expect(storage.downloads).toHaveLength(0);
  });
});

describe("contentDisposition", () => {
  it("downloads under the filed name, with an ASCII fallback for the accents", () => {
    expect(contentDisposition('Contrato "Peña".pdf')).toBe(
      `attachment; filename="Contrato Pena.pdf"; filename*=UTF-8''Contrato%20%22Pe%C3%B1a%22.pdf`,
    );
  });
});
