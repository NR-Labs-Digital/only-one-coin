import { Payment, Student } from "@ooc/domain";
import { describe, expect, it } from "vitest";

/**
 * "Aposentar é marcar, nunca apagar" (CLAUDE.md §6) used to live only in
 * whoever remembered to write `deleted_at` instead of a DELETE. Migration 0011
 * put the refusal in Postgres; this puts the affirmative half in the domain, so
 * an entity that can be retired says so in its type and carries the one way to
 * do it.
 *
 * The split is the point: `SoftDeletableModel` is a separate class rather than
 * fields on `BaseModel`, so an entity whose table is append-only never offers a
 * `softDelete()` the database would refuse. Payment is the witness here — money
 * is a ledger, it has `status` ('rejected') to say a payment does not count,
 * and 0011 blocks DELETE on it either way.
 *
 * Pure domain: no repository, no database.
 */

const A_STUDENT = {
  firstName: "Rosa",
  lastName: "Quispe",
  nationalIdType: "DNI" as const,
  nationalId: "70123456",
  email: "rosa.quispe@gmail.com",
  phone: "+51987654321",
  birthDate: new Date("1996-04-12T00:00:00.000Z"),
  country: "PE",
  region: "Lima",
  city: "Chorrillos",
};

const A_PAYMENT = {
  enrollmentId: "018f2b5c-0000-7000-8000-000000000001",
  method: "yape" as const,
  methodDetail: null,
  amountCents: 5000,
  operationNumber: "00123456",
  receiptAttached: false,
};

describe("BaseModel", () => {
  it("stamps a new record with the moment it came into being", () => {
    const before = Date.now();
    const student = Student.create(A_STUDENT);

    expect(student.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(student.updatedAt).toEqual(student.createdAt);
  });

  it("keeps the timestamps a record was rehydrated with", () => {
    const createdAt = new Date("2026-03-01T10:00:00.000Z");
    const updatedAt = new Date("2026-05-09T18:30:00.000Z");

    const student = new Student({ ...A_STUDENT, id: crypto.randomUUID(), createdAt, updatedAt });

    expect(student.createdAt).toEqual(createdAt);
    expect(student.updatedAt).toEqual(updatedAt);
  });
});

describe("SoftDeletableModel", () => {
  it("starts live", () => {
    const student = Student.create(A_STUDENT);

    expect(student.deletedAt).toBeNull();
    expect(student.isDeleted).toBe(false);
  });

  it("retires a record by marking it, keeping everything it knows", () => {
    const student = Student.create(A_STUDENT);
    const at = new Date("2026-09-22T12:00:00.000Z");

    student.softDelete(at);

    expect(student.deletedAt).toEqual(at);
    expect(student.isDeleted).toBe(true);
    // The record is retired, not erased — what it carries is exactly why the
    // row has to stay (CLAUDE.md §6).
    expect(student.nationalId).toBe(A_STUDENT.nationalId);
  });

  it("moves updatedAt to the moment of retirement", () => {
    const student = Student.create(A_STUDENT);
    const at = new Date("2026-09-22T12:00:00.000Z");

    student.softDelete(at);

    expect(student.updatedAt).toEqual(at);
  });

  // Retiring twice is not an error and does not rewrite when it happened: the
  // first marking is the one that is true, and a second pass (a re-run of the
  // same job, a double click) must not move the date.
  it("keeps the first retirement date when retired again", () => {
    const student = Student.create(A_STUDENT);
    const first = new Date("2026-09-22T12:00:00.000Z");
    const second = new Date("2026-10-01T09:00:00.000Z");

    student.softDelete(first);
    student.softDelete(second);

    expect(student.deletedAt).toEqual(first);
  });

  it("defaults the retirement to now when no moment is given", () => {
    const student = Student.create(A_STUDENT);
    const before = Date.now();

    student.softDelete();

    expect(student.deletedAt).not.toBeNull();
    expect(student.deletedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("entities outside the soft-delete contract", () => {
  // A ledger entry is never retired: `status` already says a payment does not
  // count, and 0011 refuses to remove the row. Offering softDelete() here would
  // be offering a call the database answers with OOC01.
  it("gives Payment no way to retire itself", () => {
    const payment = Payment.createManual(A_PAYMENT);

    expect("softDelete" in payment).toBe(false);
    expect("deletedAt" in payment).toBe(false);
  });

  it("still stamps Payment with the base timestamps", () => {
    const payment = Payment.createManual(A_PAYMENT);

    expect(payment.createdAt).toBeInstanceOf(Date);
    expect(payment.updatedAt).toBeInstanceOf(Date);
  });
});
