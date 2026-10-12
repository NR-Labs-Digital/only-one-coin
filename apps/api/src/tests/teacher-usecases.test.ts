import {
  InvalidFieldsError,
  RegisterTeacherUseCase,
  SetTeacherRosterStatusUseCase,
  Teacher,
  TEACHER_LEFT_ROSTER_BAN_REASON,
  TeacherAlreadyRegisteredError,
  TeacherNotFoundError,
  UpdateTeacherAvailabilityUseCase,
  UpdateTeacherUseCase,
  type CreateTeacherDTO,
} from "@ooc/domain";
import { describe, expect, it } from "vitest";
import { FakeAuditLogRepository } from "./fakes/catalog.js";
import { FakeStaffAccessRepository, FakeTeacherRepository } from "./fakes/teacher.js";

/**
 * OOC-78: the teacher file's writes. Registration refuses a document already on
 * the roster; corrections audit the names of what changed, never the values;
 * leaving the roster warns about running class groups and closes the account.
 */

const ANA: CreateTeacherDTO = {
  firstName: "Ana",
  lastName: "Quispe",
  nationalIdType: "DNI",
  nationalId: "12345678",
  email: "ana@example.com",
  phone: "+51900000000",
  nationality: "IT",
  country: "PE",
  region: "Lima",
  city: "Lima",
  addressLine: "Av. Siempre Viva 123",
  languages: ["Italiano"],
  availability: [{ weekday: "tue", startTime: "19:00", endTime: "21:00" }],
};

const { availability: _week, ...ANA_DATA } = ANA;

function setup(...onFile: Teacher[]) {
  const teachers = new FakeTeacherRepository(...onFile);
  const audit = new FakeAuditLogRepository();
  const access = new FakeStaffAccessRepository();
  return {
    teachers,
    audit,
    access,
    register: new RegisterTeacherUseCase(teachers, audit),
    update: new UpdateTeacherUseCase(teachers, audit),
    updateAvailability: new UpdateTeacherAvailabilityUseCase(teachers, audit),
    setStatus: new SetTeacherRosterStatusUseCase(teachers, access, audit),
  };
}

describe("RegisterTeacherUseCase", () => {
  it("creates the file and audits it", async () => {
    const { register, teachers, audit } = setup();

    const teacher = await register.run({ actorId: "staff-1", teacher: ANA });

    expect(teachers.created).toHaveLength(1);
    expect(teacher.status).toBe("active");
    expect(audit.appended).toEqual([
      expect.objectContaining({ actorId: "staff-1", action: "teacher.registered", targetId: teacher.id }),
    ]);
  });

  it("refuses a document already on the roster, written differently", async () => {
    const { register, teachers, audit } = setup(Teacher.create(ANA));

    await expect(
      register.run({ actorId: "staff-1", teacher: { ...ANA, firstName: "Otra", nationalId: "12.345.678" } }),
    ).rejects.toBeInstanceOf(TeacherAlreadyRegisteredError);
    expect(teachers.created).toHaveLength(0);
    expect(audit.appended).toHaveLength(0);
  });
});

describe("UpdateTeacherUseCase", () => {
  it("rewrites the file and audits only the names of the fields that changed", async () => {
    const ana = Teacher.create(ANA);
    const { update, audit } = setup(ana);

    const saved = await update.run({
      actorId: "staff-1",
      teacherId: ana.id,
      teacher: { ...ANA_DATA, phone: "+51911111111", languages: ["Italiano", "Inglés"] },
    });

    expect(saved.phone).toBe("+51911111111");
    expect(saved.languages).toEqual(["Italiano", "Inglés"]);
    expect(audit.appended).toEqual([
      expect.objectContaining({
        action: "teacher.updated",
        targetId: ana.id,
        metadata: { fields: ["phone", "languages"] },
      }),
    ]);
  });

  it("writes nothing when nothing changed, languages in another order included", async () => {
    const ana = Teacher.create({ ...ANA, languages: ["Italiano", "Inglés"] });
    const { update, teachers, audit } = setup(ana);

    await update.run({
      actorId: "staff-1",
      teacherId: ana.id,
      teacher: { ...ANA_DATA, languages: ["Inglés", "Italiano"] },
    });

    expect(teachers.updated).toHaveLength(0);
    expect(audit.appended).toHaveLength(0);
  });

  it("refuses a document that already belongs to another teacher", async () => {
    const ana = Teacher.create(ANA);
    const luis = Teacher.create({ ...ANA, firstName: "Luis", nationalId: "87654321" });
    const { update, teachers } = setup(ana, luis);

    await expect(
      update.run({ actorId: "staff-1", teacherId: luis.id, teacher: { ...ANA_DATA, firstName: "Luis" } }),
    ).rejects.toBeInstanceOf(TeacherAlreadyRegisteredError);
    expect(teachers.updated).toHaveLength(0);
  });

  it("answers 404 for an unknown teacher", async () => {
    const { update } = setup();

    await expect(
      update.run({ actorId: "staff-1", teacherId: "018f2b5c-0000-7000-8000-000000000009", teacher: ANA_DATA }),
    ).rejects.toBeInstanceOf(TeacherNotFoundError);
  });
});

describe("UpdateTeacherAvailabilityUseCase", () => {
  it("replaces the week and audits how many windows it has", async () => {
    const ana = Teacher.create(ANA);
    const { updateAvailability, audit } = setup(ana);

    const saved = await updateAvailability.run({
      actorId: "staff-1",
      teacherId: ana.id,
      availability: [
        { weekday: "mon", startTime: "09:00", endTime: "12:00" },
        { weekday: "wed", startTime: "09:00", endTime: "12:00" },
      ],
    });

    expect(saved.availability).toHaveLength(2);
    expect(audit.appended).toEqual([
      expect.objectContaining({ action: "teacher.availability_updated", metadata: { windows: 2 } }),
    ]);
  });

  it("refuses two overlapping windows of the same day", async () => {
    const ana = Teacher.create(ANA);
    const { updateAvailability, teachers } = setup(ana);

    await expect(
      updateAvailability.run({
        actorId: "staff-1",
        teacherId: ana.id,
        availability: [
          { weekday: "mon", startTime: "09:00", endTime: "12:00" },
          { weekday: "mon", startTime: "11:00", endTime: "13:00" },
        ],
      }),
    ).rejects.toBeInstanceOf(InvalidFieldsError);
    expect(teachers.updated).toHaveLength(0);
  });
});

describe("SetTeacherRosterStatusUseCase", () => {
  it("leaves the roster with class groups still running — warns, never blocks", async () => {
    const ana = Teacher.create(ANA);
    const { setStatus, teachers, audit } = setup(ana);
    teachers.running.set(ana.id, 2);

    const result = await setStatus.run({ actorId: "staff-1", teacherId: ana.id, status: "inactive" });

    expect(result.teacher.status).toBe("inactive");
    expect(result.runningClassGroups).toBe(2);
    expect(audit.appended).toEqual([
      expect.objectContaining({
        action: "teacher.left_roster",
        metadata: { runningClassGroups: 2, accountAccessChanged: false },
      }),
    ]);
  });

  it("closes the linked account on leaving and reopens it on rejoining", async () => {
    const ana = new Teacher({ ...Teacher.create(ANA), userId: "usr_ana" });
    const { setStatus, access } = setup(ana);

    await setStatus.run({ actorId: "staff-1", teacherId: ana.id, status: "inactive" });
    expect(access.banned).toEqual([{ userId: "usr_ana", reason: TEACHER_LEFT_ROSTER_BAN_REASON }]);

    await setStatus.run({ actorId: "staff-1", teacherId: ana.id, status: "active" });
    expect(access.unbanned).toEqual(["usr_ana"]);
  });

  it("writes nothing when the status is already the one asked for", async () => {
    const ana = new Teacher({ ...Teacher.create(ANA), userId: "usr_ana" });
    const { setStatus, teachers, access, audit } = setup(ana);

    await setStatus.run({ actorId: "staff-1", teacherId: ana.id, status: "active" });

    expect(teachers.updated).toHaveLength(0);
    expect(access.unbanned).toHaveLength(0);
    expect(audit.appended).toHaveLength(0);
  });
});
