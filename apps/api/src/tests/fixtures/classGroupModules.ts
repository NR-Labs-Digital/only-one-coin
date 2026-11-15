import { sql, type SQL } from "drizzle-orm";

/**
 * What migration 0058 did to every class group in production, for fixtures
 * that insert `class_groups` rows straight into the database (OOC-156): each
 * class group with no live module run gets one carrying its own teaching
 * columns, under its own id. Call it after the fixture's class groups are in;
 * running it twice adds nothing.
 */
export async function seedModuleRuns(db: { execute(query: SQL): Promise<unknown> }): Promise<void> {
  await db.execute(sql`
    insert into class_group_modules (
      id, class_group_id, module, full_course, teacher_id, teacher_name,
      slots, classroom_links, classroom_url, created_at, updated_at
    )
    select g.id, g.id, g.module, g.full_course, g.teacher_id, g.teacher_name,
           g.slots, g.classroom_links, g.classroom_url, g.created_at, g.updated_at
      from class_groups g
     where not exists (select 1 from class_group_modules m where m.class_group_id = g.id)
  `);
}
