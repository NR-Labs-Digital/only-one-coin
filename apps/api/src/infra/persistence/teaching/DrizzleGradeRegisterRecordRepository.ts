import { gradeRegisterRecords } from "@ooc/db";
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

/**
 * The teacher's actas de notas (OOC-176): one per official grade register,
 * recorded on the first download (`grade_register_records`, `0078`).
 *
 * **Which teacher.** Once recorded, the acta's own `teacher_id`; before, the
 * run's teacher now. The teacher portal scopes by that, so a run handed to
 * somebody else after its acta was recorded does not hand them the acta.
 *
 * **The counts are live.** They are read from `current_grades` on every
 * listing and print — a grade corrected after official changes them, and
 * `corrected_at` says when the last such correction happened.
 *
 * Erased class groups (`erased_at`) are out, like every catalog screen; a
 * closed or retired one stays — the acta is what a teacher is paid against,
 * after the class group closes too.
 */

/** One official register, as the list and the print read it. */
export interface GradeRegisterRecordRow {
  registerId: string;
  classGroupId: string;
  classGroupModuleId: string;
  round: number;
  classGroupCode: string;
  classGroupStatus: string;
  classGroupStartsOn: string | null;
  classGroupEndsOn: string | null;
  courseName: string;
  courseLanguage: string;
  courseLevel: string;
  courseTotalHours: number;
  academicPeriodId: string;
  academicPeriodName: string;
  module: number | null;
  /** The acta's teacher — see the file's note. Null when the run has none and nothing was recorded. */
  teacherId: string | null;
  teacherName: string | null;
  confirmedAt: Date;
  confirmedByName: string | null;
  students: number;
  didNotSit: number;
  passed: number;
  /** The last correction after the register became official; null when none. */
  correctedAt: Date | null;
  /** The recorded acta, when it was downloaded at least once. */
  record: { id: string; templateVersionId: string; data: unknown; recordedAt: Date } | null;
}

/** The teacher's file, as the acta freezes it. */
export interface RecordTeacherFacts {
  id: string;
  firstName: string;
  lastName: string;
  nationalIdType: string | null;
  nationalId: string | null;
}

interface RawRow extends Record<string, unknown> {
  register_id: string;
  class_group_id: string;
  class_group_module_id: string;
  round: number;
  class_group_code: string;
  class_group_status: string;
  starts_on: string | null;
  ends_on: string | null;
  course_name: string;
  course_language: string;
  course_level: string | null;
  course_total_hours: number | null;
  academic_period_id: string;
  academic_period_name: string;
  module: number | null;
  teacher_id: string | null;
  teacher_name: string | null;
  confirmed_at: Date;
  confirmed_by_name: string | null;
  students: number;
  did_not_sit: number;
  passed: number;
  corrected_at: Date | null;
  record_id: string | null;
  record_template_version_id: string | null;
  record_data: unknown;
  record_created_at: Date | null;
}

export interface GradeRegisterRecordFilters {
  academicPeriodId: string | null;
  teacherId: string | null;
}

export class DrizzleGradeRegisterRecordRepository {
  constructor(private readonly db: Db) {}

  /** Every official register matching the filters, newest confirmation first. */
  async list(filters: GradeRegisterRecordFilters, passingGrade: number): Promise<GradeRegisterRecordRow[]> {
    const conditions: SQL[] = [];
    if (filters.academicPeriodId) conditions.push(sql`period.id = ${filters.academicPeriodId}`);
    if (filters.teacherId) conditions.push(sql`${TEACHER_OF} = ${filters.teacherId}`);
    return this.rows(conditions, passingGrade);
  }

  /** The official register `registerId`; null when it is not one (open, erased, or no such id). */
  async findOfficial(registerId: string, passingGrade: number): Promise<GradeRegisterRecordRow | null> {
    const [row] = await this.rows([sql`r.id = ${registerId}`], passingGrade);
    return row ?? null;
  }

  async findTeacher(teacherId: string): Promise<RecordTeacherFacts | null> {
    const result = await this.db.execute<{
      id: string;
      first_name: string;
      last_name: string;
      national_id_type: string | null;
      national_id: string | null;
    }>(sql`select t.id, t.first_name, t.last_name, t.national_id_type, t.national_id
      from "teachers" t where t.id = ${teacherId}`);
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          firstName: row.first_name,
          lastName: row.last_name,
          nationalIdType: row.national_id_type,
          nationalId: row.national_id,
        }
      : null;
  }

  /**
   * Records the acta of `registerId` — or, when another download recorded it
   * first, keeps that one: the unique index decides, and the caller reads
   * the row back.
   */
  async record(params: {
    registerId: string;
    teacherId: string;
    templateVersionId: string;
    data: unknown;
    recordedBy: string;
  }): Promise<void> {
    await this.db
      .insert(gradeRegisterRecords)
      .values({
        registerId: params.registerId,
        teacherId: params.teacherId,
        templateVersionId: params.templateVersionId,
        data: params.data,
        recordedBy: params.recordedBy,
      })
      .onConflictDoNothing({ target: gradeRegisterRecords.registerId });
  }

  private async rows(conditions: SQL[], passingGrade: number): Promise<GradeRegisterRecordRow[]> {
    const where = sql.join([sql`r.status = 'official'`, sql`cg.erased_at is null`, ...conditions], sql` and `);
    const result = await this.db.execute<RawRow>(sql`
      select r.id as register_id, r.class_group_id, r.class_group_module_id, r.round,
        cg.code as class_group_code, cg.status as class_group_status,
        cg.starts_on::text as starts_on, cg.ends_on::text as ends_on,
        course.name as course_name, course.language as course_language,
        course.level as course_level, course.total_hours as course_total_hours,
        period.id as academic_period_id, period.name as academic_period_name,
        run.module,
        ${TEACHER_OF} as teacher_id,
        (select t.first_name || ' ' || t.last_name from "teachers" t where t.id = ${TEACHER_OF}) as teacher_name,
        confirm.created_at as confirmed_at,
        (select actor."name" from "user" actor where actor.id = confirm.actor_id) as confirmed_by_name,
        counts.students, counts.did_not_sit, counts.passed,
        (select max(c.created_at) from "grade_corrections" c
          join "grades" g on g.id = c.grade_id
          where g.register_id = r.id and c.created_at > confirm.created_at) as corrected_at,
        rec.id as record_id, rec.template_version_id as record_template_version_id,
        rec.data as record_data, rec.created_at as record_created_at
      from "grade_registers" r
      join "class_group_modules" run on run.id = r.class_group_module_id
      join "class_groups" cg on cg.id = r.class_group_id
      join "courses" course on course.id = cg.course_id
      join "academic_periods" period on period.id = cg.academic_period_id
      join lateral (
        select step.created_at, step.actor_id from "grade_register_events" step
        where step.register_id = r.id and step.kind = 'confirmed'
        order by step.created_at desc, step.id desc limit 1
      ) confirm on true
      cross join lateral (
        select count(*)::int as students,
          count(*) filter (where cur.did_not_sit)::int as did_not_sit,
          count(*) filter (where not cur.did_not_sit and cur.score >= ${passingGrade})::int as passed
        from "current_grades" cur where cur.register_id = r.id
      ) counts
      left join "grade_register_records" rec on rec.register_id = r.id
      where ${where}
      order by confirm.created_at desc, r.id desc`);
    return result.rows.map(toRow);
  }
}

/** The acta's teacher: the recorded one, else the run's now. Needs `rec` and `run` in scope. */
const TEACHER_OF = sql`coalesce(rec.teacher_id, run.teacher_id)`;

function toRow(row: RawRow): GradeRegisterRecordRow {
  const students = Number(row.students);
  return {
    registerId: row.register_id,
    classGroupId: row.class_group_id,
    classGroupModuleId: row.class_group_module_id,
    round: Number(row.round),
    classGroupCode: row.class_group_code,
    classGroupStatus: row.class_group_status,
    classGroupStartsOn: row.starts_on,
    classGroupEndsOn: row.ends_on,
    courseName: row.course_name,
    courseLanguage: row.course_language,
    courseLevel: row.course_level ?? "",
    courseTotalHours: Number(row.course_total_hours ?? 0),
    academicPeriodId: row.academic_period_id,
    academicPeriodName: row.academic_period_name,
    module: row.module === null ? null : Number(row.module),
    teacherId: row.teacher_id,
    teacherName: row.teacher_name,
    confirmedAt: new Date(row.confirmed_at),
    confirmedByName: row.confirmed_by_name,
    students,
    didNotSit: Number(row.did_not_sit),
    passed: Number(row.passed),
    correctedAt: row.corrected_at ? new Date(row.corrected_at) : null,
    record:
      row.record_id && row.record_template_version_id && row.record_created_at
        ? {
            id: row.record_id,
            templateVersionId: row.record_template_version_id,
            data: row.record_data,
            recordedAt: new Date(row.record_created_at),
          }
        : null,
  };
}
