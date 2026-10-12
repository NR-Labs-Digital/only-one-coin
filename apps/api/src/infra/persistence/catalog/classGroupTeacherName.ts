import { classGroups, teachers } from "@ooc/db";
import { sql } from "drizzle-orm";

/**
 * The name of the teacher allocated to a class group (OOC-80), read from the
 * roster — so a corrected teacher file shows everywhere at once. Empty when
 * nobody is allocated. A correlated subquery instead of a join, so each
 * reader keeps its own joins; `class_groups.teacher_id` is indexed.
 */
export const linkedTeacherName = sql<string>`coalesce((
  select ${teachers.firstName} || ' ' || ${teachers.lastName}
  from ${teachers}
  where ${teachers.id} = ${classGroups.teacherId}
), '')`;

/**
 * What every screen outside the class group form prints as "the teacher": the
 * allocated one, or else the free text typed before teachers had a file
 * (`class_groups.teacher_name`, kept until the contract step — CLAUDE.md §7).
 */
export const classGroupTeacherName = sql<string>`coalesce(nullif(${linkedTeacherName}, ''), ${classGroups.teacherName})`;
