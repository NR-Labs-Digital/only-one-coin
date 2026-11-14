import { students } from "@ooc/db";
import { sql, type SQL } from "drizzle-orm";

/**
 * Every live student file a portal account reaches (OOC-147), as a subquery
 * of ids — the one definition every portal read and ownership check uses.
 * Never rebuild it inline: a second copy that forgets the guardian's e-mail
 * check is a child's grades on a stranger's screen.
 *
 * Two doors:
 * - the file's own account (`students.user_id`): the student, in their Gmail;
 * - a guardian link (`guardian_portal_links`), honoured only while the file's
 *   live guardian still has the account's e-mail. Swapping or removing the
 *   guardian on the file closes the door by itself, with no write to the link.
 *
 * Retired files reach nobody. `account` is the account id as a value, or a
 * column of an outer query (`sql\`u."id"\``) for a correlated `exists`.
 */
export function reachableStudentIdsSql(account: string | SQL): SQL {
  return sql`(
    select s."id" from "students" s
     where s."user_id" = ${account} and s."deleted_at" is null
    union
    select s."id" from "guardian_portal_links" l
      join "students" s on s."id" = l."student_id" and s."deleted_at" is null
      join "guardians" g on g."student_id" = s."id" and g."deleted_at" is null
      join "user" u on u."id" = l."user_id"
     where l."user_id" = ${account} and lower(trim(g."email")) = lower(u."email")
  )`;
}

/** `students.id` is one the account reaches. */
export const reachesStudent = (userId: string): SQL => sql`${students.id} in ${reachableStudentIdsSql(userId)}`;
