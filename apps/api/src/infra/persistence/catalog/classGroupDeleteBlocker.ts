import type { ClassGroupDeleteBlocker } from "@ooc/domain";
import { sql, type SQL } from "drizzle-orm";

/**
 * Why a class group cannot be deleted — the first blocker found, or null when
 * nothing ever touched it (`CLASS_GROUP_DELETE_BLOCKERS`, domain). One copy,
 * read by the class group list (what the screen offers) and by the delete
 * itself (under the class group's lock), so the two never disagree.
 *
 * `classGroupId` is the outer class group's id. Every table inside carries its
 * own alias, so no column here can bind to the wrong table (apps/api
 * CLAUDE.md, "Armadilha do Drizzle").
 *
 * Seat holds: a hold that is still active (somebody is in the checkout now)
 * or was consumed (it became an enrollment, already caught above) blocks, and
 * so does any hold a receipt upload or an e-mail check points at. A hold that
 * expired or was released with nothing on it is a seat nobody took — the
 * delete takes it along.
 */
export function classGroupDeleteBlockerSql(classGroupId: SQL): SQL<ClassGroupDeleteBlocker | null> {
  return sql<ClassGroupDeleteBlocker | null>`(case
    when exists (select 1 from enrollments del_e where del_e.class_group_id = ${classGroupId})
      or exists (select 1 from enrollment_freezes del_f where del_f.class_group_id = ${classGroupId})
      or exists (select 1 from enrollment_freeze_returns del_r where del_r.class_group_id = ${classGroupId})
      or exists (select 1 from grades del_g where del_g.class_group_id = ${classGroupId})
      or exists (
        select 1 from issued_documents del_d
          join class_group_modules del_dm on del_dm.id = del_d.class_group_module_id
         where del_dm.class_group_id = ${classGroupId}
      )
      then 'enrollments'
    when exists (select 1 from waitlist_entries del_w where del_w.class_group_id = ${classGroupId})
      then 'waitlist'
    when exists (
      select 1 from seat_holds del_h
       where del_h.class_group_id = ${classGroupId}
         and (
           del_h.status in ('active', 'consumed')
           or exists (select 1 from receipt_uploads del_u where del_u.seat_hold_id = del_h.id)
           or exists (select 1 from email_verifications del_v where del_v.seat_hold_id = del_h.id)
         )
    )
      then 'checkout'
    when exists (select 1 from class_groups del_c where del_c.source_class_group_id = ${classGroupId})
      then 'copies'
    else null
  end)`;
}
