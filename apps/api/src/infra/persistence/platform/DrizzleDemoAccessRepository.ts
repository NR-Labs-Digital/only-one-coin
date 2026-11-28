import { randomBytes } from "node:crypto";
import {
  classGroupModules,
  classGroups,
  demoAccesses,
  enrollments,
  students,
  teacherLanguages,
  teachers,
} from "@ooc/db";
import {
  DEMO_TEACHER_ROSTER_SIZE,
  DEMO_UNDELIVERABLE_DOMAIN,
  DemoCourseUnavailableError,
  classGroupCodeOf,
  retiredStaffEmail,
  type DemoAccessKind,
  type DemoAccessView,
  type DemoCourseOption,
  type DemoKit,
  type DemoKitInput,
  type IDemoAccessRepository,
  type RevokedDemoAccess,
  type WeeklySlot,
} from "@ooc/domain";
import { sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { forgetTrustedBrowsersSql } from "@/infra/auth/trustedBrowsers.js";
import { scheduleTextFromSlots } from "@/infra/persistence/catalog/scheduleText.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Two evenings a week — a demo class group needs a schedule to show, not a real one. */
const DEMO_SLOTS: WeeklySlot[] = [
  { weekday: "tue", startTime: "19:00", endTime: "20:30" },
  { weekday: "thu", startTime: "19:00", endTime: "20:30" },
];
const DEMO_CAPACITY = 30;
const DEMO_WEEKS = 8;
/** Of age on purpose: no guardian, no consent pending — the demo is the portal, not the consent flow. */
const DEMO_BIRTH_DATE = new Date("2000-01-01T05:00:00.000Z");
const FICTITIOUS_NAMES: [string, string][] = [
  ["Lucía", "Demo Quispe"],
  ["Mateo", "Demo Huamán"],
  ["Valeria", "Demo Rojas"],
];

interface DemoGround {
  courseId: string;
  language: string;
  languageId: string | null;
  planPriceId: string;
  periodId: string;
}

/**
 * The demo rows (28/11/2026, apps/api CLAUDE.md "Contas demo"). Written with
 * `is_demo` set from the first insert, so no list ever sees them half-made.
 */
export class DrizzleDemoAccessRepository implements IDemoAccessRepository {
  constructor(private readonly db: Db) {}

  async emailInUse(email: string): Promise<boolean> {
    const result = await this.db.execute<{ taken: boolean }>(sql`
      select (
        exists(select 1 from "user" where lower("email") = ${email})
        or exists(select 1 from "staff_invites" where lower("email") = ${email} and "status" = 'pending')
        or exists(select 1 from "students" where lower("email") = ${email} and "deleted_at" is null)
        or exists(select 1 from "teachers" where lower("email") = ${email} and "deleted_at" is null)
      ) as "taken"
    `);
    return result.rows[0]?.taken ?? false;
  }

  async createStudentKit(input: DemoKitInput): Promise<DemoKit> {
    return this.db.transaction(async (tx) => {
      const ground = await this.ground(tx, input.courseId, input.at);
      const { classGroupId, runId } = await this.openClassGroup(tx, ground, input.at, null, 1);
      const studentId = await this.insertStudent(tx, input.firstName, input.lastName, input.email);
      await this.enroll(tx, ground, classGroupId, runId, studentId, input.at);
      const accessId = await this.record(tx, "student", input, classGroupId, { studentId });
      return { accessId, classGroupId, ownerId: studentId };
    });
  }

  async createTeacherKit(input: DemoKitInput): Promise<DemoKit> {
    return this.db.transaction(async (tx) => {
      const ground = await this.ground(tx, input.courseId, input.at);
      // The rest of the file stays for the teacher to fill in (OOC-103): the
      // portal opens on the onboarding, as for any teacher the coordination
      // registers that way.
      const [teacher] = await tx
        .insert(teachers)
        .values({ firstName: input.firstName, lastName: input.lastName, email: input.email, status: "active", isDemo: true })
        .returning({ id: teachers.id });
      if (!teacher) throw new Error("Insert into teachers returned no row");
      await tx.insert(teacherLanguages).values({ teacherId: teacher.id, language: ground.language, languageId: ground.languageId });

      const { classGroupId, runId } = await this.openClassGroup(tx, ground, input.at, teacher.id, DEMO_TEACHER_ROSTER_SIZE);
      // A roster to grade. Their addresses never deliver (DEMO_UNDELIVERABLE_DOMAIN).
      for (const [firstName, lastName] of FICTITIOUS_NAMES.slice(0, DEMO_TEACHER_ROSTER_SIZE)) {
        const tag = randomBytes(4).toString("hex");
        const studentId = await this.insertStudent(tx, firstName, lastName, `alumno.${tag}@${DEMO_UNDELIVERABLE_DOMAIN}`);
        await this.enroll(tx, ground, classGroupId, runId, studentId, input.at);
      }
      const accessId = await this.record(tx, "teacher", input, classGroupId, { teacherId: teacher.id });
      return { accessId, classGroupId, ownerId: teacher.id };
    });
  }

  async revoke(id: string, actorId: string, at: Date): Promise<RevokedDemoAccess | null> {
    return this.db.transaction(async (tx) => {
      const found = await tx.execute<{
        kind: DemoAccessKind;
        class_group_id: string;
        student_id: string | null;
        teacher_id: string | null;
        user_id: string | null;
      }>(sql`
        select a."kind", a."class_group_id", a."student_id", a."teacher_id",
               coalesce(s."user_id", t."user_id") as "user_id"
          from "demo_accesses" a
          left join "students" s on s."id" = a."student_id"
          left join "teachers" t on t."id" = a."teacher_id"
         where a."id" = ${id} and a."revoked_at" is null
         for update of a
      `);
      const row = found.rows[0];
      if (!row) return null;

      if (row.user_id) {
        // Retired like a deleted staff profile (OOC-136): blocked, sessions
        // dropped, and the address freed for a real account later.
        await tx.execute(sql`
          update "user"
             set "deletedAt" = ${at.toISOString()}::timestamptz, "email" = ${retiredStaffEmail(row.user_id)},
                 "banned" = true, "banReason" = 'demo_access_revoked', "updatedAt" = now()
           where "id" = ${row.user_id} and "deletedAt" is null
        `);
        await tx.execute(sql`delete from "session" where "userId" = ${row.user_id}`);
        await tx.execute(forgetTrustedBrowsersSql(row.user_id));
      }
      if (row.teacher_id) {
        await tx.execute(sql`
          update "staff_invites" set "status" = 'cancelled', "updated_at" = now()
           where "teacher_id" = ${row.teacher_id} and "status" = 'pending'
        `);
        await tx.execute(sql`update "teachers" set "status" = 'inactive', "updated_at" = now() where "id" = ${row.teacher_id}`);
      }
      // The demo file lets go of the address too, so the same person can get a
      // new demo — or a real account — later. The access row keeps it.
      const released = `revoked-${id}@${DEMO_UNDELIVERABLE_DOMAIN}`;
      if (row.student_id) {
        await tx.execute(sql`update "students" set "email" = ${released}, "updated_at" = now() where "id" = ${row.student_id}`);
      }
      if (row.teacher_id) {
        await tx.execute(sql`update "teachers" set "email" = ${released}, "updated_at" = now() where "id" = ${row.teacher_id}`);
      }
      await tx.execute(sql`
        update "class_groups" set "deleted_at" = ${at.toISOString()}::timestamptz, "updated_at" = now()
         where "id" = ${row.class_group_id} and "deleted_at" is null
      `);
      await tx.execute(sql`
        update "demo_accesses" set "revoked_at" = ${at.toISOString()}::timestamptz, "revoked_by" = ${actorId}, "updated_at" = now()
         where "id" = ${id}
      `);
      return { kind: row.kind, classGroupId: row.class_group_id };
    });
  }

  async list(): Promise<DemoAccessView[]> {
    const result = await this.db.execute<{
      id: string;
      kind: DemoAccessKind;
      email: string;
      first_name: string;
      last_name: string;
      course_name: string;
      code: string;
      activated: boolean;
      created_at: Date | string;
      created_by_name: string | null;
      revoked_at: Date | string | null;
    }>(sql`
      select a."id", a."kind", a."email",
             coalesce(s."first_name", t."first_name") as "first_name",
             coalesce(s."last_name", t."last_name") as "last_name",
             c."name" as "course_name", g."code",
             (case when a."kind" = 'student'
                   then exists(select 1 from "account" acc where acc."userId" = s."user_id" and acc."password" is not null)
                   else t."user_id" is not null end) as "activated",
             a."created_at", creator."name" as "created_by_name", a."revoked_at"
        from "demo_accesses" a
        join "class_groups" g on g."id" = a."class_group_id"
        join "courses" c on c."id" = g."course_id"
        left join "students" s on s."id" = a."student_id"
        left join "teachers" t on t."id" = a."teacher_id"
        left join "user" creator on creator."id" = a."created_by"
       order by a."created_at" desc
       limit 200
    `);
    return result.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      email: row.email,
      name: `${row.first_name} ${row.last_name}`,
      courseName: row.course_name,
      classGroupCode: row.code,
      activated: row.activated,
      createdAt: new Date(row.created_at),
      createdByName: row.created_by_name,
      revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    }));
  }

  /** Live courses with a priced one-off plan: what a demo class group can be opened in. */
  async courseOptions(): Promise<DemoCourseOption[]> {
    const result = await this.db.execute<{ id: string; name: string; language: string }>(sql`
      select c."id", c."name", c."language"
        from "courses" c
       where c."deleted_at" is null
         and exists(
           select 1 from "plans" p join "plan_prices" pp on pp."plan_id" = p."id"
            where p."course_id" = c."id" and p."deleted_at" is null and p."billing" = 'package'
              and pp."valid_from" <= now()
         )
       order by c."language", c."name"
    `);
    return result.rows;
  }

  /** The course, its one-off plan price in force and the current period — or the course cannot host a demo. */
  private async ground(tx: Tx, courseId: string, at: Date): Promise<DemoGround> {
    const now = at.toISOString();
    const result = await tx.execute<{
      course_id: string;
      language: string;
      language_id: string | null;
      plan_price_id: string | null;
      period_id: string | null;
    }>(sql`
      select c."id" as "course_id", c."language", c."language_id",
             (select pp."id" from "plans" p join "plan_prices" pp on pp."plan_id" = p."id"
               where p."course_id" = c."id" and p."deleted_at" is null and p."billing" = 'package'
                 and pp."valid_from" <= ${now}::timestamptz
               order by pp."valid_from" desc, pp."id" desc limit 1) as "plan_price_id",
             (select ap."id" from "academic_periods" ap
               where ap."starts_on" <= ${now}::timestamptz and ap."deleted_at" is null
               order by ap."starts_on" desc, ap."id" desc limit 1) as "period_id"
        from "courses" c
       where c."id" = ${courseId} and c."deleted_at" is null
    `);
    const row = result.rows[0];
    if (!row?.plan_price_id || !row.period_id) throw new DemoCourseUnavailableError();
    return {
      courseId: row.course_id,
      language: row.language,
      languageId: row.language_id,
      planPriceId: row.plan_price_id,
      periodId: row.period_id,
    };
  }

  /**
   * In progress from today, with the enrollment window already closed: a
   * demo class group never sells, even before the `is_demo` filters.
   */
  private async openClassGroup(
    tx: Tx,
    ground: DemoGround,
    at: Date,
    teacherId: string | null,
    seats: number,
  ): Promise<{ classGroupId: string; runId: string }> {
    const seq = await tx.execute<{ seq: string }>(sql`select nextval('class_group_code_seq')::text as "seq"`);
    const code = classGroupCodeOf(Number(seq.rows[0]?.seq));
    const startsOn = new Date(at);
    const endsOn = new Date(at.getTime() + DEMO_WEEKS * 7 * 24 * 60 * 60 * 1000);

    const [group] = await tx
      .insert(classGroups)
      .values({
        courseId: ground.courseId,
        academicPeriodId: ground.periodId,
        schedule: scheduleTextFromSlots(DEMO_SLOTS),
        slots: DEMO_SLOTS,
        code,
        teacherId,
        module: 1,
        startsOn,
        endsOn,
        enrollmentClosesAt: at,
        capacity: DEMO_CAPACITY,
        seatsTaken: seats,
        status: "in_progress",
        isDemo: true,
      })
      .returning({ id: classGroups.id });
    if (!group) throw new Error("Insert into class_groups returned no row");

    const [run] = await tx
      .insert(classGroupModules)
      .values({
        classGroupId: group.id,
        module: 1,
        teacherId,
        slots: DEMO_SLOTS,
        moduleEndsOn: endsOn.toISOString().slice(0, 10),
      })
      .returning({ id: classGroupModules.id });
    if (!run) throw new Error("Insert into class_group_modules returned no row");
    return { classGroupId: group.id, runId: run.id };
  }

  private async insertStudent(tx: Tx, firstName: string, lastName: string, email: string): Promise<string> {
    const [student] = await tx
      .insert(students)
      .values({
        firstName,
        lastName,
        // Never a real document: a passport number nobody holds.
        nationalIdType: "passport",
        nationalId: `DEMO${randomBytes(4).toString("hex").toUpperCase()}`,
        email,
        phone: "999999999",
        birthDate: DEMO_BIRTH_DATE,
        country: "PE",
        region: null,
        city: "Lima",
        isDemo: true,
      })
      .returning({ id: students.id });
    if (!student) throw new Error("Insert into students returned no row");
    return student.id;
  }

  /** Confirmed without a payment — the demo exception (CLAUDE.md §1), held to the demo class group. */
  private async enroll(tx: Tx, ground: DemoGround, classGroupId: string, runId: string, studentId: string, at: Date) {
    await tx.insert(enrollments).values({
      studentId,
      classGroupId,
      planPriceId: ground.planPriceId,
      seatStatus: "confirmed",
      origin: "web",
      classGroupModuleId: runId,
      moduleAttempt: 1,
      moduleEnteredAt: at,
    });
  }

  private async record(
    tx: Tx,
    kind: DemoAccessKind,
    input: DemoKitInput,
    classGroupId: string,
    owner: { studentId?: string; teacherId?: string },
  ): Promise<string> {
    const [row] = await tx
      .insert(demoAccesses)
      .values({
        kind,
        email: input.email,
        classGroupId,
        studentId: owner.studentId ?? null,
        teacherId: owner.teacherId ?? null,
        createdBy: input.actorId,
      })
      .returning({ id: demoAccesses.id });
    if (!row) throw new Error("Insert into demo_accesses returned no row");
    return row.id;
  }
}
