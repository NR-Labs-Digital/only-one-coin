import { randomUUID } from "node:crypto";
import type { Role } from "@ooc/domain";
import { hashPassword } from "better-auth/crypto";
import { createLocalAccountIssuer } from "better-auth/db";
import { sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

/** A pool or a transaction — anything that runs raw SQL. */
export type SqlExecutor = Pick<Db, "execute">;

const CREDENTIAL_PROVIDER = "credential";

/**
 * Better Auth's public sign-up is closed (`disableSignUp`, betterAuth.ts), and
 * that closes `auth.api.signUpEmail` for server calls too — the check sits in
 * the endpoint itself (better-auth/dist/api/routes/sign-up.mjs). So every
 * account apps/api creates is written here, in the exact shape sign-up writes:
 * a "user" row, and a credential "account" row whose `accountId` is the user
 * id and whose `issuer` is `createLocalAccountIssuer("credential")` — the
 * pair sign-in looks the password up by (sign-in.mjs).
 *
 * The e-mail is stored lower-cased, as sign-in lower-cases before looking up.
 * `role` is written directly: it is `input:false` towards the client, and this
 * never runs on a client's behalf.
 */
export async function insertPasswordlessUser(
  db: SqlExecutor,
  input: { email: string; name: string; role: Role; profileId?: string | null },
): Promise<string> {
  const userId = randomUUID();
  await db.execute(
    sql`insert into "user" ("id", "name", "email", "emailVerified", "role", "profile_id", "createdAt", "updatedAt")
        values (${userId}, ${input.name}, ${input.email.trim().toLowerCase()}, false, ${input.role},
                ${input.profileId ?? null}, now(), now())`,
  );
  return userId;
}

export async function insertCredentialUser(
  db: SqlExecutor,
  input: { email: string; name: string; role: Role; profileId?: string | null; password: string },
): Promise<string> {
  const userId = await insertPasswordlessUser(db, input);
  await insertCredential(db, userId, await hashPassword(input.password));
  return userId;
}

/**
 * Sets the password, creating the credential row when the account has none
 * yet — a student account is born without one (it is set from the activation
 * link). Same hasher Better Auth uses (`better-auth/crypto`).
 */
export async function upsertCredentialPassword(db: SqlExecutor, userId: string, plainPassword: string): Promise<void> {
  const hashed = await hashPassword(plainPassword);
  const updated = await db.execute(
    sql`update "account" set "password" = ${hashed}, "updatedAt" = now()
        where "userId" = ${userId} and "providerId" = ${CREDENTIAL_PROVIDER}`,
  );
  if ((updated.rowCount ?? 0) === 0) await insertCredential(db, userId, hashed);
}

async function insertCredential(db: SqlExecutor, userId: string, hashedPassword: string): Promise<void> {
  await db.execute(
    sql`insert into "account" ("id", "accountId", "providerId", "userId", "password", "issuer", "createdAt", "updatedAt")
        values (${randomUUID()}, ${userId}, ${CREDENTIAL_PROVIDER}, ${userId}, ${hashedPassword},
                ${createLocalAccountIssuer(CREDENTIAL_PROVIDER)}, now(), now())`,
  );
}
