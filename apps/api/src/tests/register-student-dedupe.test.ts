import { describe, expect, it } from "vitest";
import {
  Guardian,
  RegisterStudentUseCase,
  Student,
  StudentAlreadyRegisteredError,
  type IGuardianRepository,
  type IStudentRepository,
  type NationalIdType,
} from "@ooc/domain";

/**
 * One person, one record (CLAUDE.md §1 — "puxando o cadastro existente, nunca
 * duplicando `student`"). Until this rule existed, every path that wrote a
 * student inserted blindly, so the same DNI could open as many files as it was
 * typed times — and each file took a slice of the person's history with it.
 *
 * The usecase is pure domain, so the repositories here are fakes: no Postgres,
 * no container. What the database contributes to the same rule (the unique
 * index that holds when two staff members save the same document in the same
 * instant) is a migration, and is not what this test covers.
 */

const A_STUDENT = {
  firstName: "Rosa",
  lastName: "Quispe",
  nationalIdType: "DNI" as NationalIdType,
  nationalId: "70123456",
  email: "rosa.quispe@gmail.com",
  phone: "+51987654321",
  birthDate: new Date("1996-04-12T00:00:00.000Z"),
  country: "PE",
  region: "Lima",
  city: "Chorrillos",
};

class FakeStudentRepository implements IStudentRepository {
  public created: Student[] = [];

  constructor(private readonly onFile: Student | null) {}

  async create(student: Student): Promise<Student> {
    this.created.push(student);
    return student;
  }

  async findByNationalId(params: {
    nationalIdType: NationalIdType;
    nationalId: string;
  }): Promise<Student | null> {
    if (!this.onFile) return null;
    const matches =
      this.onFile.nationalIdType === params.nationalIdType &&
      this.onFile.nationalId === params.nationalId;
    return matches ? this.onFile : null;
  }
}

class FakeGuardianRepository implements IGuardianRepository {
  async create(guardian: Guardian): Promise<Guardian> {
    return guardian;
  }
}

describe("RegisterStudentUseCase — one person, one record", () => {
  it("registers somebody whose document is not on file yet", async () => {
    const students = new FakeStudentRepository(null);
    const usecase = new RegisterStudentUseCase(students, new FakeGuardianRepository());

    const result = await usecase.run({ student: A_STUDENT, guardian: null });

    expect(result.student.nationalId).toBe("70123456");
    expect(students.created).toHaveLength(1);
  });

  it("refuses a second file for a document already registered", async () => {
    const onFile = Student.create(A_STUDENT);
    const students = new FakeStudentRepository(onFile);
    const usecase = new RegisterStudentUseCase(students, new FakeGuardianRepository());

    // Same human being, retyped: a different spelling and a new e-mail are
    // exactly how a duplicate used to get in.
    await expect(
      usecase.run({
        student: { ...A_STUDENT, firstName: "ROSA", email: "rosa.q.2026@gmail.com" },
        guardian: null,
      }),
    ).rejects.toBeInstanceOf(StudentAlreadyRegisteredError);

    expect(students.created).toHaveLength(0);
  });

  it("lets the same person through when the document differs", async () => {
    const onFile = Student.create(A_STUDENT);
    const students = new FakeStudentRepository(onFile);
    const usecase = new RegisterStudentUseCase(students, new FakeGuardianRepository());

    // A CE and a DNI carrying the same digits are two different documents —
    // the pair is what identifies, never the number alone.
    const result = await usecase.run({
      student: { ...A_STUDENT, nationalIdType: "CE" },
      guardian: null,
    });

    expect(result.student.nationalIdType).toBe("CE");
    expect(students.created).toHaveLength(1);
  });
});
