import { sql } from "drizzle-orm";
import { LocaleSchema, type IUserPreferenceRepository, type Locale } from "@ooc/domain";
import type { Db } from "@/infra/db/client.js";

// Raw SQL against Better Auth's "user" table, which is not modelled in
// packages/db/src/schema.ts — same as DrizzleUserRoleRepository. The column
// is 0053's, CHECKed to the three locales.
export class DrizzleUserPreferenceRepository implements IUserPreferenceRepository {
  constructor(private readonly db: Db) {}

  async findPreferredLocale(userId: string): Promise<Locale | null> {
    const rows = await this.db.execute<{ preferredLocale: string | null }>(
      sql`select "preferredLocale" from "user" where "id" = ${userId}`,
    );
    const parsed = LocaleSchema.safeParse(rows.rows[0]?.preferredLocale);
    return parsed.success ? parsed.data : null;
  }

  async setPreferredLocale(userId: string, locale: Locale): Promise<void> {
    await this.db.execute(
      sql`update "user" set "preferredLocale" = ${locale}, "updatedAt" = now() where "id" = ${userId}`,
    );
  }
}
