import {
  AttachmentAccess,
  ConfirmAttachmentUploadUseCase,
  ExpirePendingAttachmentsUseCase,
  ListAttachmentsUseCase,
  OpenAttachmentUseCase,
  RemoveAttachmentUseCase,
  RequestAttachmentUploadUseCase,
  normalizeAttachmentName,
  type AttachmentActor,
  type AttachmentInspection,
  type AttachmentListItem,
  type AttachmentOwner,
  type AuditLogEntry,
  type IAttachmentOwners,
  type IAttachmentRepository,
  type IAttachmentStorage,
  type NewAttachment,
  type StoredAttachment,
  type UploadedAttachmentFacts,
} from "@ooc/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { ATTACHMENT_STAFF_POLICY } from "@/http/attachment/attachmentRoles.js";

/**
 * The generic attachment flow (OOC-143), against in-memory ports: who reaches
 * whose files, what the confirm step checks in the bytes, and the sweep.
 */

const STUDENT_A = "018f2b5c-0000-7000-8000-00000000000a";
const STUDENT_A_OLD = "018f2b5c-0000-7000-8000-0000000000a0";
const STUDENT_B = "018f2b5c-0000-7000-8000-00000000000b";
const MAX = 1000;

type Row = StoredAttachment & { createdAt: Date; facts?: UploadedAttachmentFacts; source: string; removedBy?: string };

class MemoryRepository implements IAttachmentRepository {
  rows = new Map<string, Row>();
  async create(row: NewAttachment) {
    this.rows.set(row.id, { ...row, status: "pending", createdAt: new Date() });
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async markUploaded(id: string, facts: UploadedAttachmentFacts) {
    const row = this.rows.get(id);
    if (row?.status !== "pending") return false;
    Object.assign(row, { status: "uploaded", mimeType: facts.mimeType, facts });
    return true;
  }
  async markRejected(id: string) {
    const row = this.rows.get(id);
    if (row?.status !== "pending") return false;
    row.status = "rejected";
    return true;
  }
  async markRemoved(id: string, params: { by: string }) {
    const row = this.rows.get(id);
    if (row?.status !== "uploaded") return false;
    Object.assign(row, { status: "removed", removedBy: params.by });
    return true;
  }
  async listByOwners(type: string, ids: readonly string[]): Promise<AttachmentListItem[]> {
    return [...this.rows.values()]
      .filter((row) => row.status === "uploaded" && row.owner.type === type && ids.includes(row.owner.id))
      .map((row) => ({
        id: row.id,
        category: row.category,
        originalName: row.originalName,
        mimeType: row.mimeType,
        sizeBytes: row.facts!.sizeBytes,
        source: row.source as "portal",
        uploadedAt: row.facts!.at,
        uploadedByName: null,
      }));
  }
  async listStalePending(params: { before: Date }) {
    return [...this.rows.values()]
      .filter((row) => row.status === "pending" && row.createdAt < params.before)
      .map((row) => ({ id: row.id, objectKey: row.objectKey }));
  }
}

class MemoryStorage implements IAttachmentStorage {
  objects = new Map<string, AttachmentInspection>();
  deleted: string[] = [];
  async createUploadTarget(params: { objectKey: string }) {
    return { url: "https://bucket.example", fields: { key: params.objectKey } };
  }
  async inspect(key: string) {
    return this.objects.get(key) ?? null;
  }
  async createDownloadUrl(params: { objectKey: string }) {
    return `https://bucket.example/${params.objectKey}?signed`;
  }
  async delete(key: string) {
    this.deleted.push(key);
    this.objects.delete(key);
  }
}

const owners: IAttachmentOwners = {
  exists: async (owner) => [STUDENT_A, STUDENT_A_OLD, STUDENT_B].includes(owner.id),
  studentsOfAccount: async (userId) =>
    userId === "account-a" ? [STUDENT_A, STUDENT_A_OLD] : userId === "account-b" ? [STUDENT_B] : [],
  studentsOfProfile: async (userId) =>
    userId === "account-a" ? [STUDENT_A, STUDENT_A_OLD] : userId === "account-b" ? [STUDENT_B] : [],
};

const staff: AttachmentActor = { userId: "staff-1", role: "enrollment_supervisor" };
const studentA: AttachmentActor = { userId: "account-a", role: "student" };
const studentB: AttachmentActor = { userId: "account-b", role: "student" };
const ownerA: AttachmentOwner = { type: "student", id: STUDENT_A };

let repository: MemoryRepository;
let storage: MemoryStorage;
let audit: AuditLogEntry[];
let access: AttachmentAccess;
let request: RequestAttachmentUploadUseCase;
let confirm: ConfirmAttachmentUploadUseCase;
let list: ListAttachmentsUseCase;
let open: OpenAttachmentUseCase;
let remove: RemoveAttachmentUseCase;

beforeEach(() => {
  repository = new MemoryRepository();
  storage = new MemoryStorage();
  audit = [];
  const auditLog = { append: async (entry: AuditLogEntry) => void audit.push(entry) };
  access = new AttachmentAccess(owners, ATTACHMENT_STAFF_POLICY);
  request = new RequestAttachmentUploadUseCase(repository, storage, access, MAX);
  confirm = new ConfirmAttachmentUploadUseCase(repository, storage, access, auditLog, MAX);
  list = new ListAttachmentsUseCase(repository, access);
  open = new OpenAttachmentUseCase(repository, storage, access, auditLog);
  remove = new RemoveAttachmentUseCase(repository, access, auditLog);
});

async function upload(actor: AttachmentActor, owner: AttachmentOwner | null, landed: Partial<AttachmentInspection> = {}) {
  const { attachmentId } = await request.run({
    actor,
    owner,
    category: "national_id",
    fileName: "C:\\fakepath\\DNI Peña.pdf",
    contentType: "application/pdf",
    sizeBytes: 500,
  });
  storage.objects.set(`documents/${attachmentId}`, {
    byteSize: 500,
    checksumSha256: "ab".repeat(32),
    detectedType: "application/pdf",
    ...landed,
  });
  return attachmentId;
}

describe("request upload", () => {
  it("keys the object by the id, never by the name, and keeps only the last path segment", async () => {
    const id = await upload(staff, ownerA);
    const row = repository.rows.get(id)!;
    expect(row.objectKey).toBe(`documents/${id}`);
    expect(row.originalName).toBe("DNI Peña.pdf");
    expect(row.source).toBe("backoffice");
  });

  it("refuses a type outside the list and a size over the cap before minting", async () => {
    const base = { actor: staff, owner: ownerA, category: "other" as const, fileName: "x" };
    await expect(request.run({ ...base, contentType: "text/html", sizeBytes: 1 })).rejects.toMatchObject({
      reason: "attachment.unsupported_type",
    });
    await expect(request.run({ ...base, contentType: "image/png", sizeBytes: MAX + 1 })).rejects.toMatchObject({
      reason: "attachment.too_large",
    });
    expect(repository.rows.size).toBe(0);
  });

  it("refuses a cargo outside the policy, and an owner that does not exist", async () => {
    const owner = { type: "student" as const, id: STUDENT_A };
    await expect(upload({ userId: "s", role: "support" }, owner)).rejects.toMatchObject({ status: 403 });
    await expect(upload(staff, { type: "student", id: "018f2b5c-0000-7000-8000-0000000000ff" })).rejects.toMatchObject({
      reason: "attachment.owner_not_found",
    });
  });

  it("hangs a student's upload off their newest file, whatever owner they name", async () => {
    const id = await upload(studentA, { type: "student", id: STUDENT_B });
    expect(repository.rows.get(id)!.owner).toEqual(ownerA);
    expect(repository.rows.get(id)!.source).toBe("portal");
  });

  it("refuses a student account with no file behind it — a null scope is not an id", async () => {
    await expect(upload({ userId: "account-none", role: "student" }, null)).rejects.toMatchObject({ status: 404 });
  });
});

describe("confirm", () => {
  it("lists the file with what the bytes say, and logs it without the name", async () => {
    const id = await upload(staff, ownerA, { detectedType: "image/png" });
    await confirm.run({ actor: staff, attachmentId: id });
    expect(repository.rows.get(id)!.status).toBe("uploaded");
    expect(repository.rows.get(id)!.mimeType).toBe("image/png");
    expect(audit).toEqual([
      expect.objectContaining({
        action: "attachment.uploaded",
        targetId: id,
        metadata: { ownerType: "student", ownerId: STUDENT_A, category: "national_id", studentId: STUDENT_A },
      }),
    ]);
    expect(JSON.stringify(audit)).not.toContain("Peña");
  });

  it("is idempotent", async () => {
    const id = await upload(staff, ownerA);
    await confirm.run({ actor: staff, attachmentId: id });
    await confirm.run({ actor: staff, attachmentId: id });
    expect(audit).toHaveLength(1);
  });

  it("keeps the row pending while nothing landed", async () => {
    const id = await upload(staff, ownerA);
    storage.objects.clear();
    await expect(confirm.run({ actor: staff, attachmentId: id })).rejects.toMatchObject({ reason: "attachment.not_uploaded" });
    expect(repository.rows.get(id)!.status).toBe("pending");
  });

  it("rejects and deletes a file whose magic bytes are not an accepted type", async () => {
    const id = await upload(staff, ownerA, { detectedType: "application/x-msdownload" });
    await expect(confirm.run({ actor: staff, attachmentId: id })).rejects.toMatchObject({
      reason: "attachment.unsupported_type",
    });
    expect(repository.rows.get(id)!.status).toBe("rejected");
    expect(storage.deleted).toEqual([`documents/${id}`]);
  });

  it("rejects a file with no recognizable bytes and one over the cap", async () => {
    const unknown = await upload(staff, ownerA, { detectedType: null });
    await expect(confirm.run({ actor: staff, attachmentId: unknown })).rejects.toMatchObject({ status: 422 });
    const large = await upload(staff, ownerA, { byteSize: MAX + 1 });
    await expect(confirm.run({ actor: staff, attachmentId: large })).rejects.toMatchObject({ reason: "attachment.too_large" });
  });

  it("is only for whoever started the upload", async () => {
    const id = await upload(staff, ownerA);
    await expect(confirm.run({ actor: { userId: "staff-2", role: "admin" }, attachmentId: id })).rejects.toMatchObject({
      reason: "attachment.not_found",
    });
  });
});

describe("list, download and remove", () => {
  it("shows staff and portal uploads in the same list; a student sees every file of the account and nobody else's", async () => {
    await confirm.run({ actor: staff, attachmentId: await upload(staff, ownerA) });
    await confirm.run({ actor: studentA, attachmentId: await upload(studentA, null) });
    const old = await upload(staff, { type: "student", id: STUDENT_A_OLD });
    await confirm.run({ actor: staff, attachmentId: old });
    await confirm.run({ actor: studentB, attachmentId: await upload(studentB, null) });

    expect((await list.run({ actor: staff, owner: ownerA })).map((item) => item.source).sort()).toEqual([
      "backoffice",
      "portal",
    ]);
    expect(await list.run({ actor: studentA, owner: null })).toHaveLength(3);
    expect(await list.run({ actor: studentB, owner: null })).toHaveLength(1);
  });

  it("downloads through a signed link and logs it; someone else's file is not found", async () => {
    const id = await upload(staff, ownerA);
    await confirm.run({ actor: staff, attachmentId: id });
    await expect(open.run({ actor: studentA, attachmentId: id })).resolves.toEqual({
      url: `https://bucket.example/documents/${id}?signed`,
    });
    expect(audit.at(-1)).toMatchObject({ action: "attachment.downloaded", actorId: "account-a" });
    await expect(open.run({ actor: studentB, attachmentId: id })).rejects.toMatchObject({ reason: "attachment.not_found" });
    await expect(open.run({ actor: { userId: "x", role: "billing" }, attachmentId: id })).rejects.toMatchObject({
      reason: "attachment.not_found",
    });
  });

  it("does not hand out a link to a file still pending", async () => {
    const id = await upload(staff, ownerA);
    await expect(open.run({ actor: staff, attachmentId: id })).rejects.toMatchObject({ reason: "attachment.not_found" });
  });

  it("removes softly, staff only, and the removed file leaves the list", async () => {
    const id = await upload(studentA, null);
    await confirm.run({ actor: studentA, attachmentId: id });
    await expect(remove.run({ actor: studentA, attachmentId: id })).rejects.toMatchObject({ status: 404 });
    await remove.run({ actor: staff, attachmentId: id });
    expect(repository.rows.get(id)).toMatchObject({ status: "removed", removedBy: "staff-1" });
    expect(storage.deleted).toEqual([]);
    expect(await list.run({ actor: staff, owner: ownerA })).toEqual([]);
    expect(audit.at(-1)).toMatchObject({ action: "attachment.removed" });
  });
});

describe("sweep", () => {
  it("clears uploads never confirmed after the hour, and leaves fresh and confirmed ones", async () => {
    const stale = await upload(staff, ownerA);
    const fresh = await upload(staff, ownerA);
    const done = await upload(staff, ownerA);
    await confirm.run({ actor: staff, attachmentId: done });
    repository.rows.get(stale)!.createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    repository.rows.get(done)!.createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000);

    const result = await new ExpirePendingAttachmentsUseCase(repository, storage).run();
    expect(result).toEqual({ expired: 1 });
    expect(repository.rows.get(stale)!.status).toBe("rejected");
    expect(repository.rows.get(fresh)!.status).toBe("pending");
    expect(repository.rows.get(done)!.status).toBe("uploaded");
    expect(storage.deleted).toEqual([`documents/${stale}`]);
  });
});

describe("normalizeAttachmentName", () => {
  it("keeps the last segment, drops control characters and never ends empty", () => {
    expect(normalizeAttachmentName("../../etc/passwd")).toBe("passwd");
    expect(normalizeAttachmentName("a\u0000b.pdf")).toBe("ab.pdf");
    expect(normalizeAttachmentName("   ")).toBe("file");
    expect(normalizeAttachmentName("x".repeat(300))).toHaveLength(200);
  });
});
