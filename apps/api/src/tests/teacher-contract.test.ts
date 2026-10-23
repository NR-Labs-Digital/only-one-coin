import {
  FileTeacherContractUseCase,
  InvalidFieldsError,
  OpenTeacherContractUseCase,
  RequestTeacherContractUploadUseCase,
  Teacher,
  TEACHER_CONTRACT_CONTENT_TYPE,
  TEACHER_CONTRACT_MAX_BYTES,
  TeacherContractAlreadyFiledError,
  TeacherContractInvalidFileError,
  TeacherContractNotFoundError,
  TeacherContractUploadMissingError,
  TeacherNotFoundError,
  teacherContractObjectKey,
  type CreateTeacherDTO,
} from "@ooc/domain";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { PdfLibInspector } from "@/infra/pdf/PdfLibInspector.js";
import { contentDisposition } from "@/infra/storage/TigrisTeacherContractStorage.js";
import { FakeAuditLogRepository } from "./fakes/catalog.js";
import { FakeTeacherContractRepository, FakeTeacherContractStorage, FakeTeacherRepository } from "./fakes/teacher.js";

/**
 * OOC-81: a signed contract goes straight to the bucket, is filed with the
 * period it covers, and opens through a five-minute link. Only a PDF is
 * filed; every filing and every opening is in the audit log.
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

/** A real one-page PDF, built once. */
let PDF: Uint8Array;
/**
 * A header with nothing behind it — byte for byte the 45-byte file the first
 * cut of this feature accepted and filed. It starts with `%PDF-`, ends with
 * `%%EOF`, and has no page to open.
 */
const HOLLOW_PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

beforeAll(async () => {
  const document = await PDFDocument.create();
  document.addPage();
  PDF = await document.save();
});
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const UPLOAD_ID = "018f2b5c-0000-7000-8000-0000000000aa";
const FORM = { fileName: "Contrato Ana Quispe 2026.pdf", startsOn: "2026-03-01", endsOn: "2026-12-31" };

function setup() {
  const teacher = Teacher.create(ANA);
  const teachers = new FakeTeacherRepository(teacher);
  const contracts = new FakeTeacherContractRepository();
  const storage = new FakeTeacherContractStorage();
  const audit = new FakeAuditLogRepository();
  return {
    teacher,
    contracts,
    storage,
    audit,
    key: teacherContractObjectKey(teacher.id, UPLOAD_ID),
    request: new RequestTeacherContractUploadUseCase(teachers, storage),
    file: new FileTeacherContractUseCase(teachers, contracts, storage, new PdfLibInspector(), audit),
    open: new OpenTeacherContractUseCase(contracts, storage, audit),
  };
}

describe("RequestTeacherContractUploadUseCase", () => {
  it("mints a PDF-only, size-capped target under the teacher, writing nothing", async () => {
    const { request, storage, teacher, contracts } = setup();

    const result = await request.run({ teacherId: teacher.id });

    expect(storage.targets).toEqual([
      {
        objectKey: teacherContractObjectKey(teacher.id, result.contractUploadId),
        contentType: TEACHER_CONTRACT_CONTENT_TYPE,
        maxBytes: TEACHER_CONTRACT_MAX_BYTES,
      },
    ]);
    expect(contracts.rows).toHaveLength(0);
  });

  it("refuses a teacher that is not on file", async () => {
    const { request } = setup();
    await expect(request.run({ teacherId: "018f2b5c-0000-7000-8000-0000000000ff" })).rejects.toBeInstanceOf(
      TeacherNotFoundError,
    );
  });
});

describe("FileTeacherContractUseCase", () => {
  it("files the PDF with its period, under the key the server built, and audits it", async () => {
    const { file, storage, contracts, audit, teacher, key } = setup();
    storage.objects.set(key, PDF);

    const contract = await file.run({ actorId: "staff-1", teacherId: teacher.id, contractUploadId: UPLOAD_ID, contract: FORM });

    expect(contract).toMatchObject({
      id: UPLOAD_ID,
      teacherId: teacher.id,
      objectKey: key,
      fileName: FORM.fileName,
      fileSizeBytes: PDF.length,
      uploadedBy: "staff-1",
    });
    expect(contract.startsOn.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(contract.endsOn.toISOString()).toBe("2026-12-31T00:00:00.000Z");
    expect(contracts.rows).toHaveLength(1);
    expect(audit.appended).toEqual([
      expect.objectContaining({
        actorId: "staff-1",
        action: "teacher.contract_filed",
        targetId: teacher.id,
        metadata: { contractId: UPLOAD_ID },
      }),
    ]);
  });

  it("keeps only the name after the last path separator", async () => {
    const { file, storage, teacher, key } = setup();
    storage.objects.set(key, PDF);

    const contract = await file.run({
      actorId: "staff-1",
      teacherId: teacher.id,
      contractUploadId: UPLOAD_ID,
      contract: { ...FORM, fileName: "C:\\fakepath\\contrato.pdf" },
    });

    expect(contract.fileName).toBe("contrato.pdf");
  });

  it("refuses an upload that never landed", async () => {
    const { file, teacher, contracts } = setup();

    await expect(
      file.run({ actorId: "staff-1", teacherId: teacher.id, contractUploadId: UPLOAD_ID, contract: FORM }),
    ).rejects.toBeInstanceOf(TeacherContractUploadMissingError);
    expect(contracts.rows).toHaveLength(0);
  });

  it("refuses and removes a file that is not a PDF, whatever it was called", async () => {
    const { file, storage, teacher, contracts, audit, key } = setup();
    storage.objects.set(key, PNG);

    await expect(
      file.run({ actorId: "staff-1", teacherId: teacher.id, contractUploadId: UPLOAD_ID, contract: FORM }),
    ).rejects.toBeInstanceOf(TeacherContractInvalidFileError);
    expect(storage.deleted).toEqual([key]);
    expect(contracts.rows).toHaveLength(0);
    expect(audit.appended).toHaveLength(0);
  });

  it("refuses and removes a file that claims to be a PDF but has no page to open", async () => {
    const { file, storage, teacher, contracts, key } = setup();
    expect(HOLLOW_PDF.length).toBe(45);
    storage.objects.set(key, HOLLOW_PDF);

    await expect(
      file.run({ actorId: "staff-1", teacherId: teacher.id, contractUploadId: UPLOAD_ID, contract: FORM }),
    ).rejects.toBeInstanceOf(TeacherContractInvalidFileError);
    expect(storage.deleted).toEqual([key]);
    expect(contracts.rows).toHaveLength(0);
  });

  it("refuses a file over the cap without reading it", async () => {
    const { file, storage, teacher, key } = setup();
    storage.objects.set(key, new Uint8Array(TEACHER_CONTRACT_MAX_BYTES + 1));

    await expect(
      file.run({ actorId: "staff-1", teacherId: teacher.id, contractUploadId: UPLOAD_ID, contract: FORM }),
    ).rejects.toBeInstanceOf(TeacherContractInvalidFileError);
    expect(storage.reads).toHaveLength(0);
    expect(storage.deleted).toEqual([key]);
  });

  it("refuses a period that ends before it starts, keeping the upload for a corrected try", async () => {
    const { file, storage, teacher, contracts, key } = setup();
    storage.objects.set(key, PDF);

    const attempt = file.run({
      actorId: "staff-1",
      teacherId: teacher.id,
      contractUploadId: UPLOAD_ID,
      contract: { ...FORM, startsOn: "2026-12-31", endsOn: "2026-03-01" },
    });

    await expect(attempt).rejects.toBeInstanceOf(InvalidFieldsError);
    await expect(attempt).rejects.toMatchObject({ fields: [{ path: "contract.endsOn", code: "invalid" }] });
    expect(storage.objects.has(key)).toBe(true);
    expect(contracts.rows).toHaveLength(0);
  });

  it("refuses a filing without a name or a date", async () => {
    const { file, storage, teacher, key } = setup();
    storage.objects.set(key, PDF);

    await expect(
      file.run({
        actorId: "staff-1",
        teacherId: teacher.id,
        contractUploadId: UPLOAD_ID,
        contract: { fileName: "  ", startsOn: "", endsOn: "2026-02-30" },
      }),
    ).rejects.toMatchObject({
      fields: expect.arrayContaining([
        { path: "contract.fileName", code: "required" },
        { path: "contract.startsOn", code: "invalid" },
        { path: "contract.endsOn", code: "invalid" },
      ]),
    });
  });

  it("only reaches uploads made for the teacher in the URL", async () => {
    const { file, storage, teacher } = setup();
    // Somebody else's upload, under another teacher's prefix.
    storage.objects.set(teacherContractObjectKey("018f2b5c-0000-7000-8000-0000000000bb", UPLOAD_ID), PDF);

    await expect(
      file.run({ actorId: "staff-1", teacherId: teacher.id, contractUploadId: UPLOAD_ID, contract: FORM }),
    ).rejects.toBeInstanceOf(TeacherContractUploadMissingError);
  });

  it("refuses filing the same upload twice", async () => {
    const { file, storage, teacher, key } = setup();
    storage.objects.set(key, PDF);
    const input = { actorId: "staff-1", teacherId: teacher.id, contractUploadId: UPLOAD_ID, contract: FORM };

    await file.run(input);
    await expect(file.run(input)).rejects.toBeInstanceOf(TeacherContractAlreadyFiledError);
  });
});

describe("OpenTeacherContractUseCase", () => {
  it("signs a five-minute link under the filed name and audits the opening", async () => {
    const { file, open, storage, audit, teacher, key } = setup();
    storage.objects.set(key, PDF);
    await file.run({ actorId: "staff-1", teacherId: teacher.id, contractUploadId: UPLOAD_ID, contract: FORM });

    const result = await open.run({ actorId: "staff-2", teacherId: teacher.id, contractId: UPLOAD_ID });

    expect(result.url).toContain(key);
    expect(storage.downloads).toEqual([{ objectKey: key, fileName: FORM.fileName, expiresInSeconds: 300 }]);
    expect(audit.appended.at(-1)).toMatchObject({
      actorId: "staff-2",
      action: "teacher.contract_viewed",
      targetId: teacher.id,
      metadata: { contractId: UPLOAD_ID },
    });
  });

  it("answers 404 for a contract of another teacher, without signing anything", async () => {
    const { file, open, storage, teacher, key } = setup();
    storage.objects.set(key, PDF);
    await file.run({ actorId: "staff-1", teacherId: teacher.id, contractUploadId: UPLOAD_ID, contract: FORM });

    await expect(
      open.run({ actorId: "staff-2", teacherId: "018f2b5c-0000-7000-8000-0000000000bb", contractId: UPLOAD_ID }),
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
