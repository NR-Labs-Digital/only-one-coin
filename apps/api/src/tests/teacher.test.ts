import { CreateTeacherSchema, InvalidFieldsError, Teacher, type CreateTeacherDTO } from "@ooc/domain";
import { describe, expect, it } from "vitest";

/**
 * The teacher file's own rules (OOC-77), pure domain: the same name and
 * document rules as a student, a weekly availability that runs forwards and
 * never overlaps itself, and leaving the roster without leaving the record.
 */

const VALID: CreateTeacherDTO = {
  firstName: "  Ana ",
  lastName: "Quispe",
  nationalIdType: "DNI",
  nationalId: "12.345.678",
  email: "Ana.Quispe@Example.com",
  phone: "+51 900 000 000",
  nationality: "it",
  country: "pe",
  region: "Lima",
  city: "Lima",
  addressLine: "Av. Siempre Viva 123",
  languages: ["Italiano", "Inglés"],
  availability: [
    { weekday: "tue", startTime: "19:00", endTime: "21:00" },
    { weekday: "tue", startTime: "21:00", endTime: "22:00" },
  ],
};

function codesOf(dto: CreateTeacherDTO): string[] {
  try {
    Teacher.create(dto);
    return [];
  } catch (error) {
    if (!(error instanceof InvalidFieldsError)) throw error;
    return error.fields.map((field) => `${field.path}:${field.code}`);
  }
}

describe("Teacher.create", () => {
  it("normalizes what it stores and starts on the roster", () => {
    const teacher = Teacher.create(VALID);

    expect(teacher.firstName).toBe("Ana");
    expect(teacher.nationalId).toBe("12345678");
    expect(teacher.email).toBe("ana.quispe@example.com");
    expect(teacher.nationality).toBe("IT");
    expect(teacher.country).toBe("PE");
    expect(teacher.status).toBe("active");
    expect(teacher.isActive).toBe(true);
    expect(teacher.userId).toBeNull();
    expect(teacher.isDeleted).toBe(false);
  });

  it("holds the document to its type's format", () => {
    expect(codesOf({ ...VALID, nationalId: "123" })).toEqual(["teacher.nationalId:national_id_format"]);
  });

  it("asks for the departamento inside Peru", () => {
    expect(codesOf({ ...VALID, region: null })).toEqual(["teacher.region:required"]);
  });

  it("does not ask a teacher's e-mail to be Gmail", () => {
    expect(codesOf({ ...VALID, email: "ana@institucion.edu.pe" })).toEqual([]);
  });

  it("refuses a window that does not run forwards", () => {
    expect(codesOf({ ...VALID, availability: [{ weekday: "mon", startTime: "20:00", endTime: "19:00" }] })).toEqual([
      "teacher.availability.0:invalid",
    ]);
  });

  it("refuses two windows of the same day that overlap", () => {
    expect(
      codesOf({
        ...VALID,
        availability: [
          { weekday: "wed", startTime: "18:00", endTime: "20:00" },
          { weekday: "wed", startTime: "19:30", endTime: "21:00" },
        ],
      }),
    ).toEqual(["teacher.availability.1:invalid"]);
  });

  it("refuses the same language twice, whatever the case", () => {
    expect(codesOf({ ...VALID, languages: ["Inglés", "inglés"] })).toEqual(["teacher.languages.1:invalid"]);
  });

  it("parses through the exported schema the same way", () => {
    expect(CreateTeacherSchema.safeParse(VALID).success).toBe(true);
  });
});

describe("Teacher roster", () => {
  it("leaves and rejoins the roster without retiring the record", () => {
    const teacher = Teacher.create(VALID);
    const at = new Date("2026-10-11T15:00:00.000Z");

    teacher.leaveRoster(at);
    expect(teacher.status).toBe("inactive");
    expect(teacher.isActive).toBe(false);
    expect(teacher.isDeleted).toBe(false);
    expect(teacher.updatedAt).toEqual(at);

    teacher.rejoinRoster();
    expect(teacher.isActive).toBe(true);
  });
});
