import { classroomAccounts, teachers } from "@ooc/db";
import type { IPlatformSettingsRepository } from "@ooc/domain";
import { and, asc, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

export interface ClassroomAccountRow {
  id: string;
  email: string;
  /** The teachers using it now, by name. */
  teachers: { id: string; firstName: string; lastName: string }[];
  passwordChangedAt: Date;
  /** The last time a teacher stopped using it; null if none ever did. */
  releasedAt: Date | null;
  /** A teacher left after the last password change (OOC-196). */
  passwordChangeDue: boolean;
}

export interface ClassroomAccountList {
  items: ClassroomAccountRow[];
  /** `classroom_account_max_teachers`, so the screen shows "5 / 7" from the same number the API holds. */
  maxTeachers: number;
}

/**
 * The shared Classroom logins with who uses each (OOC-196) — never the
 * password, which has a route of its own and an audit line per reveal.
 */
export class ListClassroomAccountsQuery {
  constructor(
    private readonly db: Db,
    private readonly settings: IPlatformSettingsRepository,
  ) {}

  async run(): Promise<ClassroomAccountList> {
    const [rows, settings] = await Promise.all([
      this.db
        .select({
          id: classroomAccounts.id,
          email: classroomAccounts.email,
          passwordChangedAt: classroomAccounts.passwordChangedAt,
          releasedAt: classroomAccounts.releasedAt,
          teachers: sql<{ id: string; firstName: string; lastName: string }[]>`coalesce((
            select json_agg(json_build_object('id', t.id, 'firstName', t.first_name, 'lastName', t.last_name)
              order by t.first_name, t.last_name)
            from ${teachers} t
            where t.classroom_account_id = ${classroomAccounts.id} and t.deleted_at is null
          ), '[]'::json)`,
        })
        .from(classroomAccounts)
        .where(and(isNull(classroomAccounts.deletedAt)))
        .orderBy(asc(sql`lower(${classroomAccounts.email})`)),
      this.settings.get(),
    ]);

    return {
      items: rows.map((row) => ({
        ...row,
        passwordChangeDue: row.releasedAt !== null && row.releasedAt > row.passwordChangedAt,
      })),
      maxTeachers: settings.classroomAccountMaxTeachers,
    };
  }
}
