import { sql } from "drizzle-orm";
import type { Role } from "@ooc/domain";
import { container } from "@/container.js";
import { insertCredentialUser } from "@/infra/auth/credentialAccount.js";

// Local preview account (the `preview` skill, .claude/skills/preview): one
// account per staff role, so seeing a screen as another cargo is a second
// account, not an edit to the first. Refuses any database that is not on this
// machine — it writes `role` directly, like seed-admin, and a well-known
// password must never reach staging or production.
const PASSWORD = "preview1234";

/**
 * Staff cargos that sign in with the password alone. master/admin/billing ask
 * for an e-mailed code on every sign-in (MFA_REQUIRED_ROLES), and teacher,
 * student and guardian hang off a file (teachers/students.user_id) this does
 * not create.
 */
const PREVIEW_ROLES = ["enrollment_supervisor", "academic_supervisor", "analyst", "sales", "support"] as const satisfies readonly Role[];
type PreviewRole = (typeof PREVIEW_ROLES)[number];

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "").hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`Refusing to seed a preview account on ${host}: local databases only.`);
  }
  const role = (process.env.PREVIEW_ROLE ?? "enrollment_supervisor") as PreviewRole;
  if (!PREVIEW_ROLES.includes(role)) throw new Error(`Preview role must be one of: ${PREVIEW_ROLES.join(", ")}.`);

  const email = `preview.${role}@example.com`;
  const existing = await container.db.execute(sql`select "id" from "user" where "email" = ${email}`);
  if (existing.rows.length === 0) {
    await insertCredentialUser(container.db, { email, name: `Preview ${role}`, role: role, password: PASSWORD });
  }
  // Always back to the cargo asked for, whatever a test run changed.
  await container.db.execute(sql`update "user" set role = ${role} where email = ${email}`);

  console.log(JSON.stringify({ email, password: PASSWORD, role: role }));
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
