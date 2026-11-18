import * as schema from "@ooc/db";
import {
  academicPeriods,
  auditLog,
  classGroups,
  consents,
  courses,
  enrollments,
  guardianPortalLinks,
  guardians,
  outbox,
  planPrices,
  plans,
  portalAccessTokens,
  students,
} from "@ooc/db";
import { newPortalToken, portalCredentialsEmail, type PortalAccountProvisioning } from "@ooc/domain";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { insertPasswordlessUser, upsertCredentialPassword } from "@/infra/auth/credentialAccount.js";
import { profilesOfAccount } from "./accountProfiles.js";
import { DrizzlePortalAccessRepository } from "./DrizzlePortalAccessRepository.js";
import { DrizzleGuardianConsentRepository } from "./DrizzleGuardianConsentRepository.js";
import { provisionPortalAccount } from "./provisionPortalAccount.js";
import { seedModuleRuns } from "@/tests/fixtures/classGroupModules.js";

/**
 * The SQL behind student portal access. `students`, `audit_log` are under the
 * delete lock (0011): every test runs inside a transaction that is always
 * rolled back, and the repository is built on that transaction.
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required for this suite.");

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
class RolledBack extends Error {}

let pool: pg.Pool;
let db: Db;

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  db = drizzle(pool, { schema, casing: "snake_case" });
});
afterAll(async () => {
  await pool.end();
});

async function rolledBack(fn: (tx: Tx, repo: DrizzlePortalAccessRepository) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx, new DrizzlePortalAccessRepository(tx as unknown as Db));
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
}

async function insertStudent(tx: Tx, overrides: Partial<typeof students.$inferInsert> = {}): Promise<string> {
  const [row] = await tx
    .insert(students)
    .values({
      firstName: "Ana",
      lastName: "Quispe",
      nationalIdType: "DNI",
      nationalId: "12345678",
      email: "ana.quispe@gmail.com",
      phone: "999999999",
      birthDate: new Date("2010-05-01T00:00:00.000Z"),
      country: "PE",
      city: "Lima",
      ...overrides,
    })
    .returning({ id: students.id });
  return row!.id;
}

function provisioning(studentId: string): PortalAccountProvisioning {
  const activation = newPortalToken("activation");
  return {
    studentId,
    actorId: "usr_billing",
    activation,
    at: new Date(),
    notify: (account, tokenId) => [portalCredentialsEmail(account, `https://student.test/access/${activation.token}`, tokenId, "es-PE")],
  };
}

describe("provisionPortalAccount", () => {
  it("creates a passwordless student account, links the file, stores the token hash and queues the e-mail", async () => {
    await rolledBack(async (tx, repo) => {
      const studentId = await insertStudent(tx);
      const request = provisioning(studentId);

      expect(await provisionPortalAccount(tx, request)).toBe("created");

      const [student] = await tx.select({ userId: students.userId }).from(students).where(eq(students.id, studentId));
      expect(student!.userId).toBeTruthy();
      const account = await repo.findAccountByStudent(studentId);
      expect(account).toEqual({ userId: student!.userId, email: "ana.quispe@gmail.com", name: "Ana Quispe", hasPassword: false });

      const tokens = await tx.select().from(portalAccessTokens).where(eq(portalAccessTokens.userId, student!.userId!));
      expect(tokens).toHaveLength(1);
      expect(tokens[0]!.tokenHash).toBe(request.activation.tokenHash);
      expect(tokens[0]!.purpose).toBe("activation");

      const mails = await tx.select().from(outbox).where(eq(outbox.recipient, "ana.quispe@gmail.com"));
      expect(mails.map((m) => m.templateKey)).toEqual(["portal_credentials"]);
      expect(JSON.stringify(mails[0]!.vars)).not.toContain(request.activation.tokenHash);

      const audits = await tx.select().from(auditLog).where(eq(auditLog.targetId, studentId));
      expect(audits.map((a) => a.action)).toContain("portal_access.created");
    });
  });

  it("does nothing the second time", async () => {
    await rolledBack(async (tx) => {
      const studentId = await insertStudent(tx);
      await provisionPortalAccount(tx, provisioning(studentId));
      expect(await provisionPortalAccount(tx, provisioning(studentId))).toBe("already_linked");
      const mails = await tx.select().from(outbox).where(eq(outbox.recipient, "ana.quispe@gmail.com"));
      expect(mails).toHaveLength(1);
    });
  });

  it("links a duplicate file of the same document — dots and all — to the existing account", async () => {
    await rolledBack(async (tx) => {
      const first = await insertStudent(tx);
      await provisionPortalAccount(tx, provisioning(first));
      const twin = await insertStudent(tx, { nationalId: "12.345.678", email: "otra.cuenta@gmail.com" });

      expect(await provisionPortalAccount(tx, provisioning(twin))).toBe("linked_existing");

      const rows = await tx.select({ id: students.id, userId: students.userId }).from(students).where(sql`${students.id} in (${first}, ${twin})`);
      expect(new Set(rows.map((r) => r.userId)).size).toBe(1);
      const mails = await tx.select().from(outbox).where(eq(outbox.recipient, "otra.cuenta@gmail.com"));
      expect(mails).toHaveLength(0);
    });
  });

  it("creates nothing when the e-mail belongs to someone else, and says so", async () => {
    await rolledBack(async (tx) => {
      await insertPasswordlessUser(tx, { email: "Ana.Quispe@gmail.com", name: "Hermana", role: "student" });
      const studentId = await insertStudent(tx);

      expect(await provisionPortalAccount(tx, provisioning(studentId))).toBe("email_conflict");

      const [student] = await tx.select({ userId: students.userId }).from(students).where(eq(students.id, studentId));
      expect(student!.userId).toBeNull();
      const audits = await tx.select().from(auditLog).where(eq(auditLog.targetId, studentId));
      expect(audits.map((a) => a.action)).toEqual(["portal_access.email_conflict"]);
    });
  });
});

describe("DrizzlePortalAccessRepository", () => {
  it("finds the account by e-mail or by document only while a live file points at it", async () => {
    await rolledBack(async (tx, repo) => {
      const studentId = await insertStudent(tx, { nationalId: "87.654.321" });
      await provisionPortalAccount(tx, provisioning(studentId));

      const byEmail = await repo.findAccountByIdentifier({ method: "email", email: "ana.quispe@gmail.com" });
      const byDocument = await repo.findAccountByIdentifier({ method: "national_id", nationalIdType: "DNI", nationalId: "87654321" });
      expect(byEmail?.userId).toBeTruthy();
      expect(byDocument?.userId).toBe(byEmail?.userId);
      expect(await repo.findAccountByIdentifier({ method: "national_id", nationalIdType: "CE", nationalId: "87654321" })).toBeNull();

      // An account no file points at (the old open sign-up) never signs in.
      await insertPasswordlessUser(tx, { email: "orphan@gmail.com", name: "Orphan", role: "student" });
      expect(await repo.findAccountByIdentifier({ method: "email", email: "orphan@gmail.com" })).toBeNull();
    });
  });

  it("issues a token, honours the cooldown, and keeps only the newest link alive", async () => {
    await rolledBack(async (tx, repo) => {
      const userId = await insertPasswordlessUser(tx, { email: "beto@gmail.com", name: "Beto", role: "student" });
      const first = newPortalToken("reset");
      const issued = await repo.issueToken({ userId, token: first, cooldownSince: null, notify: () => [] });
      expect(issued?.id).toBeTruthy();

      const blocked = await repo.issueToken({
        userId,
        token: newPortalToken("reset"),
        cooldownSince: new Date(Date.now() - 60_000),
        notify: () => [],
      });
      expect(blocked).toBeNull();

      const second = newPortalToken("reset");
      await repo.issueToken({ userId, token: second, cooldownSince: null, notify: () => [] });
      expect((await repo.findToken(first.tokenHash))?.usedAt).not.toBeNull();
      const live = await repo.findToken(second.tokenHash);
      expect(live?.usedAt).toBeNull();

      expect(await repo.consumeToken(live!.id)).toBe(true);
      expect(await repo.consumeToken(live!.id)).toBe(false);
    });
  });

  it("reports the access state and the identity behind an account", async () => {
    await rolledBack(async (tx, repo) => {
      const studentId = await insertStudent(tx);
      expect(await repo.accessState(studentId)).toBe("none");
      await provisionPortalAccount(tx, provisioning(studentId));
      expect(await repo.accessState(studentId)).toBe("pending_activation");

      const account = await repo.findAccountByStudent(studentId);
      await upsertCredentialPassword(tx, account!.userId, "first-pass-12");
      expect(await repo.accessState(studentId)).toBe("active");
      expect(await repo.findIdentity(account!.userId, null)).toEqual({
        firstName: "Ana",
        lastName: "Quispe",
        email: "ana.quispe@gmail.com",
        profileId: studentId,
        profiles: [{ id: studentId, firstName: "Ana", lastName: "Quispe" }],
      });
    });
  });

  it("knows whether the student has a confirmed seat", async () => {
    await rolledBack(async (tx, repo) => {
      const studentId = await insertStudent(tx);
      expect(await repo.hasConfirmedEnrollment(studentId)).toBe(false);
      await seedConfirmedEnrollment(tx, studentId);
      expect(await repo.hasConfirmedEnrollment(studentId)).toBe(true);
    });
  });
});

async function seedConfirmedEnrollment(tx: Tx, studentId: string): Promise<void> {
  const [period] = await tx
    .insert(academicPeriods)
    .values({ name: "Ciclo (portal integration)", startsOn: new Date("2026-03-01T00:00:00.000Z"), endsOn: new Date("2026-07-31T00:00:00.000Z") })
    .returning({ id: academicPeriods.id });
  const [course] = await tx.insert(courses).values({ name: "Curso (portal integration)", language: "Prueba", minAge: 10 }).returning({ id: courses.id });
  const [plan] = await tx.insert(plans).values({ courseId: course!.id, name: "Paquete" }).returning({ id: plans.id });
  const [price] = await tx.insert(planPrices).values({ planId: plan!.id, amountCents: 15000 }).returning({ id: planPrices.id });
  const [group] = await tx
    .insert(classGroups)
    .values({
      courseId: course!.id,
      academicPeriodId: period!.id,
      schedule: "Lun 19:00",
      startsOn: new Date("2026-03-02T00:00:00.000Z"),
      endsOn: new Date("2026-06-30T00:00:00.000Z"),
      capacity: 10,
      seatsTaken: 1,
    })
    .returning({ id: classGroups.id });
  await seedModuleRuns(tx);
  await tx.insert(enrollments).values({ studentId, classGroupId: group!.id, planPriceId: price!.id, seatStatus: "confirmed" });
}

const MINOR_BIRTH = new Date("2014-03-10T00:00:00.000Z");
const ADULT_BIRTH = new Date("1990-03-10T00:00:00.000Z");
const GUARDIAN_EMAIL = "rosa.mamani@hotmail.com";

/** The approval's provisioning, with the guardian's half (OOC-147). */
function withGuardian(studentId: string): PortalAccountProvisioning {
  const guardianActivation = newPortalToken("activation");
  return {
    ...provisioning(studentId),
    guardian: {
      activation: guardianActivation,
      notify: (account, tokenId) => [
        portalCredentialsEmail(account, `https://student.test/access/${guardianActivation.token}`, tokenId, "es-PE"),
      ],
    },
  };
}

async function insertGuardian(tx: Tx, studentId: string, email = GUARDIAN_EMAIL): Promise<void> {
  await tx.insert(guardians).values({
    studentId,
    firstName: "Rosa",
    lastName: "Mamani",
    relationship: "mother",
    nationalIdType: "DNI",
    nationalId: "40404040",
    email,
    phone: "988888888",
  });
}

async function insertChild(tx: Tx, firstName: string, nationalId: string, guardianEmail = GUARDIAN_EMAIL): Promise<string> {
  const id = await insertStudent(tx, {
    firstName,
    nationalId,
    email: `${firstName.toLowerCase()}.quispe@gmail.com`,
    birthDate: MINOR_BIRTH,
  });
  await insertGuardian(tx, id, guardianEmail);
  return id;
}

async function userIdByEmail(tx: Tx, email: string): Promise<string | null> {
  const result = await tx.execute<{ id: string }>(sql`select "id" from "user" where "email" = ${email}`);
  return result.rows[0]?.id ?? null;
}

async function mailsTo(tx: Tx, recipient: string): Promise<string[]> {
  const rows = await tx.select({ templateKey: outbox.templateKey }).from(outbox).where(eq(outbox.recipient, recipient));
  return rows.map((row) => row.templateKey);
}

async function reachedFirstNames(tx: Tx, userId: string): Promise<string[]> {
  return (await profilesOfAccount(tx as unknown as Db, userId)).map((profile) => profile.firstName).sort();
}

describe("provisionPortalAccount — the guardian's account too (OOC-147)", () => {
  it("opens two accounts for a minor: the child's in their Gmail, the guardian's in theirs", async () => {
    await rolledBack(async (tx, repo) => {
      const child = await insertChild(tx, "Lucia", "70000001");

      expect(await provisionPortalAccount(tx, withGuardian(child))).toBe("created");

      expect(await repo.findAccountByStudent(child)).toMatchObject({ email: "lucia.quispe@gmail.com", name: "Lucia Quispe" });
      expect(await mailsTo(tx, "lucia.quispe@gmail.com")).toEqual(["portal_credentials"]);
      expect(await mailsTo(tx, GUARDIAN_EMAIL)).toEqual(["portal_credentials"]);

      const guardianId = (await userIdByEmail(tx, GUARDIAN_EMAIL))!;
      expect(await reachedFirstNames(tx, guardianId)).toEqual(["Lucia"]);
      expect(await reachedFirstNames(tx, (await repo.findAccountByStudent(child))!.userId)).toEqual(["Lucia"]);
      const audits = await tx.select().from(auditLog).where(eq(auditLog.targetId, child));
      expect(audits.map((a) => a.action).sort()).toEqual(["portal_access.created", "portal_access.guardian_created"]);
    });
  });

  it("joins a second child to the guardian's account, with no second e-mail to the guardian", async () => {
    await rolledBack(async (tx) => {
      const lucia = await insertChild(tx, "Lucia", "70000001");
      const mateo = await insertChild(tx, "Mateo", "70000002");
      await provisionPortalAccount(tx, withGuardian(lucia));

      expect(await provisionPortalAccount(tx, withGuardian(mateo))).toBe("created");

      expect(await mailsTo(tx, GUARDIAN_EMAIL)).toEqual(["portal_credentials"]);
      expect(await mailsTo(tx, "mateo.quispe@gmail.com")).toEqual(["portal_credentials"]);
      expect(await reachedFirstNames(tx, (await userIdByEmail(tx, GUARDIAN_EMAIL))!)).toEqual(["Lucia", "Mateo"]);
      const audits = await tx.select().from(auditLog).where(eq(auditLog.targetId, mateo));
      expect(audits.map((a) => a.action)).toContain("portal_access.linked_guardian");
    });
  });

  it("matches the guardian's address without regard to case", async () => {
    await rolledBack(async (tx) => {
      const lucia = await insertChild(tx, "Lucia", "70000001");
      await provisionPortalAccount(tx, withGuardian(lucia));
      const mateo = await insertChild(tx, "Mateo", "70000002", "Rosa.Mamani@Hotmail.com");

      await provisionPortalAccount(tx, withGuardian(mateo));

      expect(await reachedFirstNames(tx, (await userIdByEmail(tx, GUARDIAN_EMAIL))!)).toEqual(["Lucia", "Mateo"]);
    });
  });

  it("adds the child to a guardian who studies too", async () => {
    await rolledBack(async (tx) => {
      const mother = await insertStudent(tx, {
        firstName: "Rosa",
        lastName: "Mamani",
        nationalId: "40404040",
        email: GUARDIAN_EMAIL,
        birthDate: ADULT_BIRTH,
      });
      await provisionPortalAccount(tx, provisioning(mother));
      const child = await insertChild(tx, "Lucia", "70000001");

      await provisionPortalAccount(tx, withGuardian(child));

      expect(await reachedFirstNames(tx, (await userIdByEmail(tx, GUARDIAN_EMAIL))!)).toEqual(["Lucia", "Rosa"]);
      expect(await mailsTo(tx, GUARDIAN_EMAIL)).toEqual(["portal_credentials"]);
    });
  });

  it("never lets a staff account behind the guardian's address in — the child still gets theirs", async () => {
    await rolledBack(async (tx, repo) => {
      const staffId = await insertPasswordlessUser(tx, { email: GUARDIAN_EMAIL, name: "Rosa Staff", role: "support" });
      const child = await insertChild(tx, "Lucia", "70000001");

      expect(await provisionPortalAccount(tx, withGuardian(child))).toBe("created");

      expect(await repo.findAccountByStudent(child)).toMatchObject({ email: "lucia.quispe@gmail.com" });
      expect(await reachedFirstNames(tx, staffId)).toEqual([]);
      const audits = await tx.select().from(auditLog).where(eq(auditLog.targetId, child));
      expect(audits.map((a) => a.action)).toContain("portal_access.guardian_conflict");
    });
  });

  it("never lets a blocked account in", async () => {
    await rolledBack(async (tx) => {
      const lucia = await insertChild(tx, "Lucia", "70000001");
      await provisionPortalAccount(tx, withGuardian(lucia));
      const guardianId = (await userIdByEmail(tx, GUARDIAN_EMAIL))!;
      await tx.execute(sql`update "user" set "banned" = true where "id" = ${guardianId}`);
      const mateo = await insertChild(tx, "Mateo", "70000002");

      await provisionPortalAccount(tx, withGuardian(mateo));

      expect(await tx.select().from(guardianPortalLinks).where(eq(guardianPortalLinks.studentId, mateo))).toEqual([]);
    });
  });

  it("opens nothing for the guardian of an adult, or when the guardian typed the child's own address", async () => {
    await rolledBack(async (tx) => {
      const adult = await insertStudent(tx, { birthDate: ADULT_BIRTH });
      await insertGuardian(tx, adult);
      await provisionPortalAccount(tx, withGuardian(adult));
      expect(await userIdByEmail(tx, GUARDIAN_EMAIL)).toBeNull();

      const child = await insertChild(tx, "Lucia", "70000001", "lucia.quispe@gmail.com");
      await provisionPortalAccount(tx, withGuardian(child));
      expect(await tx.select().from(guardianPortalLinks).where(eq(guardianPortalLinks.studentId, child))).toEqual([]);
      expect(await mailsTo(tx, "lucia.quispe@gmail.com")).toEqual(["portal_credentials"]);
    });
  });

  it("leaves a file that already had an account alone — a later approval adds no guardian", async () => {
    await rolledBack(async (tx) => {
      const child = await insertChild(tx, "Lucia", "70000001");
      await provisionPortalAccount(tx, provisioning(child));

      expect(await provisionPortalAccount(tx, withGuardian(child))).toBe("already_linked");
      expect(await userIdByEmail(tx, GUARDIAN_EMAIL)).toBeNull();
    });
  });

  it("closes the guardian's door when the guardian's address on the file changes", async () => {
    await rolledBack(async (tx, repo) => {
      const child = await insertChild(tx, "Lucia", "70000001");
      await provisionPortalAccount(tx, withGuardian(child));
      const guardianId = (await userIdByEmail(tx, GUARDIAN_EMAIL))!;
      expect(await repo.findAccountByIdentifier({ method: "email", email: GUARDIAN_EMAIL })).not.toBeNull();

      await tx.update(guardians).set({ email: "otra.persona@hotmail.com" }).where(eq(guardians.studentId, child));

      expect(await reachedFirstNames(tx, guardianId)).toEqual([]);
      expect(await repo.findIdentity(guardianId, null)).toBeNull();
      expect(await repo.findAccountByIdentifier({ method: "email", email: GUARDIAN_EMAIL })).toBeNull();
      expect(await reachedFirstNames(tx, (await repo.findAccountByStudent(child))!.userId)).toEqual(["Lucia"]);
    });
  });
});

describe("a child with no address of their own (OOC-147)", () => {
  // The file always carries an e-mail (students.email is NOT NULL, the
  // checkout asks for a Gmail): a child with none is enrolled with the
  // parent's address, as the student's and as the guardian's.
  it("lets the parent reach every child through the one account at that address", async () => {
    await rolledBack(async (tx) => {
      const lucia = await insertStudent(tx, { firstName: "Lucia", nationalId: "70000001", email: GUARDIAN_EMAIL, birthDate: MINOR_BIRTH });
      await insertGuardian(tx, lucia);
      const mateo = await insertStudent(tx, { firstName: "Mateo", nationalId: "70000002", email: GUARDIAN_EMAIL, birthDate: MINOR_BIRTH });
      await insertGuardian(tx, mateo);

      expect(await provisionPortalAccount(tx, withGuardian(lucia))).toBe("created");
      // The second child's own account cannot exist — the address is taken —
      // so the approval reports the conflict, and the guardian link still lets
      // the parent in.
      expect(await provisionPortalAccount(tx, withGuardian(mateo))).toBe("email_conflict");

      const parent = (await userIdByEmail(tx, GUARDIAN_EMAIL))!;
      expect(await reachedFirstNames(tx, parent)).toEqual(["Lucia", "Mateo"]);
      expect(await mailsTo(tx, GUARDIAN_EMAIL)).toEqual(["portal_credentials"]);
      const repo = new DrizzlePortalAccessRepository(tx as unknown as Db);
      expect(await repo.findAccountByIdentifier({ method: "email", email: GUARDIAN_EMAIL })).toMatchObject({ userId: parent });
    });
  });

  it("reaches them through the guardian's own address when the child's is a third one", async () => {
    await rolledBack(async (tx) => {
      const lucia = await insertStudent(tx, { firstName: "Lucia", nationalId: "70000001", email: "familia.quispe@gmail.com", birthDate: MINOR_BIRTH });
      await insertGuardian(tx, lucia);
      const mateo = await insertStudent(tx, { firstName: "Mateo", nationalId: "70000002", email: "familia.quispe@gmail.com", birthDate: MINOR_BIRTH });
      await insertGuardian(tx, mateo);

      await provisionPortalAccount(tx, withGuardian(lucia));
      await provisionPortalAccount(tx, withGuardian(mateo));

      expect(await reachedFirstNames(tx, (await userIdByEmail(tx, GUARDIAN_EMAIL))!)).toEqual(["Lucia", "Mateo"]);
      expect(await reachedFirstNames(tx, (await userIdByEmail(tx, "familia.quispe@gmail.com"))!)).toEqual(["Lucia"]);
    });
  });
});

describe("account profiles (OOC-147)", () => {
  it("is one profile per person: two children are two, a child's duplicate file is the same one", async () => {
    await rolledBack(async (tx) => {
      const lucia = await insertChild(tx, "Lucia", "70000001");
      const mateo = await insertChild(tx, "Mateo", "70000002");
      await provisionPortalAccount(tx, withGuardian(lucia));
      await provisionPortalAccount(tx, withGuardian(mateo));
      const guardianId = (await userIdByEmail(tx, GUARDIAN_EMAIL))!;
      const luciaAgain = await insertChild(tx, "Lucia", "70.000.001");
      await tx.insert(guardianPortalLinks).values({ userId: guardianId, studentId: luciaAgain });

      const profiles = await profilesOfAccount(tx as unknown as Db, guardianId);

      expect(profiles).toHaveLength(2);
      expect(new Set(profiles.find((profile) => profile.firstName === "Lucia")!.fileIds)).toEqual(new Set([lucia, luciaAgain]));
      expect(profiles.find((profile) => profile.firstName === "Mateo")!.fileIds).toEqual([mateo]);
    });
  });

  it("shows the profile asked for, and answers someone else's file like no profile at all", async () => {
    await rolledBack(async (tx) => {
      const lucia = await insertChild(tx, "Lucia", "70000001");
      const mateo = await insertChild(tx, "Mateo", "70000002");
      await provisionPortalAccount(tx, withGuardian(lucia));
      await provisionPortalAccount(tx, withGuardian(mateo));
      const guardianId = (await userIdByEmail(tx, GUARDIAN_EMAIL))!;
      const stranger = await insertStudent(tx, { firstName: "Pedro", nationalId: "80000001", email: "pedro@gmail.com", birthDate: ADULT_BIRTH });
      await provisionPortalAccount(tx, provisioning(stranger));
      const repo = new DrizzlePortalAccessRepository(tx as unknown as Db);

      const asked = await repo.findIdentity(guardianId, lucia);
      expect(asked).toMatchObject({ firstName: "Lucia", profileId: lucia });
      expect(asked!.profiles.map((profile) => profile.firstName).sort()).toEqual(["Lucia", "Mateo"]);

      const fallback = await repo.findIdentity(guardianId, null);
      const foreign = await repo.findIdentity(guardianId, stranger);
      expect(foreign).toEqual(fallback);
      expect(foreign!.firstName).not.toBe("Pedro");
    });
  });

  it("keeps the child's own account to the child: it never sees a sibling", async () => {
    await rolledBack(async (tx, repo) => {
      const lucia = await insertChild(tx, "Lucia", "70000001");
      const mateo = await insertChild(tx, "Mateo", "70000002");
      await provisionPortalAccount(tx, withGuardian(lucia));
      await provisionPortalAccount(tx, withGuardian(mateo));

      expect(await reachedFirstNames(tx, (await repo.findAccountByStudent(lucia))!.userId)).toEqual(["Lucia"]);
      expect(await reachedFirstNames(tx, (await repo.findAccountByStudent(mateo))!.userId)).toEqual(["Mateo"]);
    });
  });
});

describe("the guardian's consent (OOC-72)", () => {
  /** The guardian's door alone, as "send portal access" opens it. */
  const guardianDoor = (studentId: string) => {
    const { guardian, ...rest } = withGuardian(studentId);
    return { studentId: rest.studentId, actorId: rest.actorId, at: rest.at, guardian: guardian! };
  };
  const guardianRowId = async (tx: Tx, studentId: string) =>
    (await tx.select({ id: guardians.id }).from(guardians).where(eq(guardians.studentId, studentId)))[0]!.id;

  it("is pending for a minor whose guardian has not accepted, and never for an adult", async () => {
    await rolledBack(async (tx, repo) => {
      const child = await insertChild(tx, "Lucia", "70000001");
      const adult = await insertStudent(tx, { nationalId: "70000009", email: "adulto@gmail.com", birthDate: ADULT_BIRTH });
      await insertGuardian(tx, adult, "tia@hotmail.com");
      const orphan = await insertStudent(tx, { nationalId: "70000008", email: "solo@gmail.com", birthDate: MINOR_BIRTH });

      expect(await repo.guardianConsentPending(child)).toBe(true);
      expect(await repo.guardianConsentPending(adult)).toBe(false);
      // No guardian: nobody to let in — the file flags it on its own.
      expect(await repo.guardianConsentPending(orphan)).toBe(false);

      await tx.insert(consents).values({ guardianId: await guardianRowId(tx, child), version: "v1", acceptedAt: new Date(), ip: "127.0.0.1" });
      expect(await repo.guardianConsentPending(child)).toBe(false);
    });
  });

  it("opens the guardian's door on a file whose own account already exists", async () => {
    await rolledBack(async (tx, repo) => {
      const child = await insertChild(tx, "Lucia", "70000001");
      await provisionPortalAccount(tx, provisioning(child));
      expect(await userIdByEmail(tx, GUARDIAN_EMAIL)).toBeNull();

      expect(await repo.openGuardianAccess(guardianDoor(child))).toEqual({ outcome: "created", account: null });
      const guardianId = (await userIdByEmail(tx, GUARDIAN_EMAIL))!;
      expect(await reachedFirstNames(tx, guardianId)).toEqual(["Lucia"]);
      expect(await mailsTo(tx, GUARDIAN_EMAIL)).toEqual(["portal_credentials"]);

      // Again: already there, and the account comes back so its activation can be re-sent.
      expect(await repo.openGuardianAccess(guardianDoor(child))).toEqual({
        outcome: "already_linked",
        account: expect.objectContaining({ userId: guardianId, hasPassword: false }),
      });
      expect(await mailsTo(tx, GUARDIAN_EMAIL)).toEqual(["portal_credentials"]);
    });
  });

  it("joins the guardian's existing account and reports a staff address", async () => {
    await rolledBack(async (tx, repo) => {
      const lucia = await insertChild(tx, "Lucia", "70000001");
      await provisionPortalAccount(tx, withGuardian(lucia));
      const mateo = await insertChild(tx, "Mateo", "70000002");
      await provisionPortalAccount(tx, provisioning(mateo));
      const guardianId = (await userIdByEmail(tx, GUARDIAN_EMAIL))!;

      expect(await repo.openGuardianAccess(guardianDoor(mateo))).toMatchObject({ outcome: "linked", account: { userId: guardianId } });
      expect(await reachedFirstNames(tx, guardianId)).toEqual(["Lucia", "Mateo"]);

      const staffChild = await insertChild(tx, "Sofia", "70000003", "coordinacion@onlyonecoin.edu.pe");
      await insertPasswordlessUser(tx, { email: "coordinacion@onlyonecoin.edu.pe", name: "Coordinación", role: "admin" });
      expect(await repo.openGuardianAccess(guardianDoor(staffChild))).toEqual({ outcome: "conflict", account: null });
    });
  });

  it("lets only the guardian's account read the consent of the profile it names, exactly", async () => {
    await rolledBack(async (tx) => {
      const consentsRepo = new DrizzleGuardianConsentRepository(tx as unknown as Db);
      const lucia = await insertChild(tx, "Lucia", "70000001");
      const mateo = await insertChild(tx, "Mateo", "70000002", "otro.papa@hotmail.com");
      await provisionPortalAccount(tx, withGuardian(lucia));
      await provisionPortalAccount(tx, withGuardian(mateo));
      const guardianId = (await userIdByEmail(tx, GUARDIAN_EMAIL))!;

      expect(await consentsRepo.findSubject(guardianId, lucia)).toEqual({
        studentId: lucia,
        birthDate: MINOR_BIRTH,
        guardian: { id: await guardianRowId(tx, lucia), email: GUARDIAN_EMAIL },
        consentGiven: false,
        accountEmail: GUARDIAN_EMAIL,
      });
      // Someone else's child: no fallback to the default profile.
      expect(await consentsRepo.findSubject(guardianId, mateo)).toBeNull();

      const guardianRow = await guardianRowId(tx, lucia);
      const consent = { guardianId: guardianRow, version: "v1", acceptedAt: new Date(), ip: "200.48.1.1" };
      expect(await consentsRepo.appendIfAbsent(consent)).toBe(true);
      expect(await consentsRepo.appendIfAbsent(consent)).toBe(false);
      expect(await tx.select({ ip: consents.ip }).from(consents).where(eq(consents.guardianId, guardianRow))).toEqual([{ ip: "200.48.1.1" }]);
      expect((await consentsRepo.findSubject(guardianId, lucia))?.consentGiven).toBe(true);
    });
  });
});
