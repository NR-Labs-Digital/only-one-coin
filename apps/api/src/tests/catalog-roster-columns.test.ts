import type { Role } from "@ooc/domain";
import { describe, expect, it } from "vitest";
import { shapeRoster } from "@/http/catalog/GetClassGroupRosterRoute.js";
import type { ClassGroupRosterRow } from "@/infra/persistence/catalog/ClassGroupRosterQuery.js";

/**
 * The roster's columns per role: the national id and the contact reach only
 * who reads the student file; every other catalog reader gets name, plan and
 * payment status. No guardian field exists on the row at all.
 */

const ROW: ClassGroupRosterRow = {
  enrollmentId: "018f2b5c-0000-7000-8000-000000000001",
  studentId: "018f2b5c-0000-7000-8000-000000000002",
  firstName: "Ana",
  lastName: "Quispe",
  nationalIdType: "DNI",
  nationalId: "12345678",
  email: "ana.quispe@gmail.com",
  phone: "+51900000000",
  planName: "Paquete completo",
  paymentStatus: "approved",
};

const FULL: Role[] = ["master", "admin", "enrollment_supervisor"];
const LIMITED: Role[] = ["analyst", "academic_supervisor", "sales", "support"];

describe("shapeRoster", () => {
  it.each(FULL)("gives %s the national id and the contact", (role) => {
    const roster = shapeRoster(role, [ROW]);
    expect(roster.view).toBe("full");
    expect(roster.items[0]).toEqual({
      enrollmentId: ROW.enrollmentId,
      studentId: ROW.studentId,
      studentName: "Ana Quispe",
      planName: "Paquete completo",
      paymentStatus: "approved",
      file: { nationalIdType: "DNI", nationalId: "12345678", email: "ana.quispe@gmail.com", phone: "+51900000000" },
    });
  });

  it.each(LIMITED)("keeps the national id and the contact from %s", (role) => {
    const roster = shapeRoster(role, [ROW]);
    expect(roster.view).toBe("limited");
    expect(roster.items[0]!.file).toBeNull();
    const serialized = JSON.stringify(roster);
    expect(serialized).not.toContain("12345678");
    expect(serialized).not.toContain("ana.quispe@gmail.com");
    expect(serialized).not.toContain("+51900000000");
  });
});
