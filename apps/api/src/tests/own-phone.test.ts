import {
  Student,
  UpdateOwnPhoneUseCase,
  type AuditLogEntry,
  type IAuditLogRepository,
  type IPortalProfileFileRepository,
  type IStudentRepository,
} from "@ooc/domain";
import { beforeEach, describe, expect, it } from "vitest";

/** The student corrects their own phone in the portal (OOC-110), pure domain. */

const FILE = "018f2b5c-0000-7000-8000-000000000001";
const OTHER_FILE = "018f2b5c-0000-7000-8000-000000000009";

const ana = () =>
  new Student({
    id: FILE,
    firstName: "Ana",
    lastName: "Quispe",
    nationalIdType: "DNI",
    nationalId: "12345678",
    email: "ana.quispe@gmail.com",
    phone: "+51 987 654 321",
    birthDate: new Date("2008-03-01"),
    country: "PE",
    region: "Lima",
    city: "Lima",
  });

class FakeProfiles implements IPortalProfileFileRepository {
  public reach = new Map<string, string>([[FILE, FILE]]);
  public asked: [string, string][] = [];
  async findProfileFileId(userId: string, profileId: string) {
    this.asked.push([userId, profileId]);
    return this.reach.get(profileId) ?? null;
  }
}

class FakeStudents implements IStudentRepository {
  public stored = ana();
  public saved: Student[] = [];
  async create(student: Student) {
    return student;
  }
  async findById(id: string) {
    return id === this.stored.id ? this.stored : null;
  }
  async update(student: Student) {
    this.saved.push(student);
    return student;
  }
  async findByNationalId() {
    return null;
  }
}

class FakeAudit implements IAuditLogRepository {
  public entries: AuditLogEntry[] = [];
  async append(entry: AuditLogEntry) {
    this.entries.push(entry);
  }
}

describe("UpdateOwnPhoneUseCase", () => {
  let profiles: FakeProfiles;
  let students: FakeStudents;
  let audit: FakeAudit;
  const run = (input: Partial<{ profileId: string; phone: string }> = {}) =>
    new UpdateOwnPhoneUseCase(profiles, students, audit).run({ userId: "usr_ana", profileId: FILE, phone: "+51 912 345 678", ...input });

  beforeEach(() => {
    profiles = new FakeProfiles();
    students = new FakeStudents();
    audit = new FakeAudit();
  });

  it("rewrites the phone on the profile's file and audits the field, never the number", async () => {
    await expect(run()).resolves.toEqual({ phone: "+51 912 345 678" });
    expect(profiles.asked).toEqual([["usr_ana", FILE]]);
    expect(students.saved.map((student) => student.phone)).toEqual(["+51 912 345 678"]);
    expect(audit.entries).toEqual([
      expect.objectContaining({
        actorId: "usr_ana",
        action: "student.phone_self_updated",
        targetId: FILE,
        metadata: { fields: ["phone"] },
      }),
    ]);
  });

  it("writes to the profile's own file when another of the person's files is named", async () => {
    profiles.reach.set(OTHER_FILE, FILE);
    await run({ profileId: OTHER_FILE });
    expect(students.saved.map((student) => student.id)).toEqual([FILE]);
  });

  it("leaves everything but the phone untouched", async () => {
    await run();
    const [saved] = students.saved;
    expect(saved).toMatchObject({ firstName: "Ana", nationalId: "12345678", email: "ana.quispe@gmail.com" });
  });

  it("writes nothing when the phone did not change", async () => {
    await expect(run({ phone: "  +51 987 654 321 " })).resolves.toEqual({ phone: "+51 987 654 321" });
    expect(students.saved).toEqual([]);
    expect(audit.entries).toEqual([]);
  });

  it("refuses a phone that breaks the registration rule, with the field and the code", async () => {
    await expect(run({ phone: "12" })).rejects.toMatchObject({
      status: 400,
      fields: [{ path: "phone", code: "phone_format" }],
    });
    await expect(run({ phone: "   " })).rejects.toMatchObject({ fields: expect.arrayContaining([{ path: "phone", code: "required" }]) });
    expect(students.saved).toEqual([]);
  });

  it("answers a profile the account does not reach like one that does not exist", async () => {
    profiles.reach.clear();
    await expect(run()).rejects.toMatchObject({ status: 404, reason: "portal_profile.not_found" });
    expect(students.saved).toEqual([]);
  });
});
