import {
  lateness,
  registerDeadline,
  type ConfirmedSeat,
  type GradeRegisterListFilters,
  type GradeRegisterListRow,
  type GradeRegisterStatus,
  type GradeRegisterStep,
  type GradeRegisterStepKind,
  type GradeRegisterView,
  type IGradeRegisterRepository,
  type RegisterTransitionOutcome,
} from "@ooc/domain";
import { auditLog, gradeRegisterEvents, gradeRegisters } from "@ooc/db";
import { and, eq, ne, sql, type SQL } from "drizzle-orm";
import type { AuditLogEntry } from "@ooc/domain";
import type { Db } from "@/infra/db/client.js";
import { insertOutboxEmails } from "@/infra/persistence/notification/DrizzleOutboxRepository.js";
import { gradeEmailFactsOf } from "./DrizzleGradeRepository.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * The grade registers (OOC-180, `0072`). A register is a module run and a
 * round; its status lives on the row and every step in the append-only
 * `grade_register_events`. Every step locks the run's open register first,
 * then re-reads what it decides on — a send and an edit, or two coordinators
 * confirming, never cross.
 *
 * **A round's seats** are the run's confirmed seats whose current attempt is
 * graded in this register or not graded at all — a seat graded in an earlier,
 * official register (waiting for the next run to open) belongs to that one.
 * The same SQL counts for the screens and decides "complete" in a step.
 *
 * Correlated pieces carry their own aliases and qualified names on purpose
 * (the Drizzle trap in `classGroupModuleSql.ts`).
 */

/** A run, as the list reads it. */
interface RunRow extends Record<string, unknown> {
  run_id: string;
  class_group_id: string;
  class_group_code: string;
  class_group_status: string;
  course_name: string;
  academic_period_id: string;
  academic_period_name: string;
  module: number | null;
  slots: unknown;
  teacher_id: string | null;
  teacher_name: string | null;
  module_ends_on: string | null;
  /** Confirmed seats of the run with no grade this attempt, and none open register. */
  ungraded: number;
}

interface RegisterRow extends Record<string, unknown> {
  id: string;
  class_group_id: string;
  class_group_module_id: string;
  round: number;
  status: GradeRegisterStatus;
  total: number;
  graded: number;
}

interface StepRow extends Record<string, unknown> {
  register_id: string;
  kind: GradeRegisterStepKind;
  note: string | null;
  module_ends_on: string | null;
  created_at: Date;
  by_name: string | null;
}

/** The confirmed seats of a run now, as a FROM clause aliased `seat`. */
function seatsOfRun(runId: SQL | string): SQL {
  return sql`"enrollments" seat
    where coalesce(seat.class_group_module_id, seat.class_group_id) = ${runId}
      and seat.seat_status = 'confirmed' and seat.deleted_at is null`;
}

/** The current attempt's grade of `seat` in its run, as an EXISTS body over `posted`. */
const CURRENT_GRADE_OF_SEAT = sql`select 1 from "grades" posted
  where posted.enrollment_id = seat.id
    and coalesce(posted.class_group_module_id, posted.class_group_id) = coalesce(seat.class_group_module_id, seat.class_group_id)
    and posted.attempt = seat.module_attempt`;

/**
 * The counts of a register: an open one counts its round's seats; an
 * official one, the grades it holds — its seats may have moved on since.
 */
function countsOf(register: SQL): { total: SQL<number>; graded: SQL<number> } {
  const graded = sql<number>`(select count(*)::int from "grades" held where held.register_id = ${register}.id)`;
  const openTotal = sql<number>`(select count(*)::int from ${seatsOfRun(sql`${register}.class_group_module_id`)}
    and not exists (${CURRENT_GRADE_OF_SEAT} and posted.register_id is distinct from ${register}.id))`;
  const openGraded = sql<number>`(select count(*)::int from ${seatsOfRun(sql`${register}.class_group_module_id`)}
    and exists (${CURRENT_GRADE_OF_SEAT} and posted.register_id = ${register}.id))`;
  return {
    total: sql<number>`case when ${register}.status = 'official' then ${graded} else ${openTotal} end`,
    graded: sql<number>`case when ${register}.status = 'official' then ${graded} else ${openGraded} end`,
  };
}

const REGISTER_COUNTS = countsOf(sql.raw(`"r"`));

/** The registers matching `where`, with their counts. */
async function registerRows(db: Db | Tx, where: SQL): Promise<RegisterRow[]> {
  const result = await db.execute<RegisterRow>(sql`
    select r.id, r.class_group_id, r.class_group_module_id, r.round, r.status,
      ${REGISTER_COUNTS.total} as total, ${REGISTER_COUNTS.graded} as graded
    from "grade_registers" r
    where ${where}
    order by r.round desc`);
  return result.rows;
}

async function stepRows(db: Db | Tx, registerIds: string[]): Promise<Map<string, StepRow[]>> {
  const byRegister = new Map<string, StepRow[]>();
  if (registerIds.length === 0) return byRegister;
  const result = await db.execute<StepRow>(sql`
    select step.register_id, step.kind, step.note, step.module_ends_on::text as module_ends_on, step.created_at,
      (select actor."name" from "user" actor where actor.id = step.actor_id) as by_name
    from "grade_register_events" step
    where step.register_id in (${sql.join(
      registerIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
    order by step.created_at asc, step.id asc`);
  for (const row of result.rows) {
    const list = byRegister.get(row.register_id) ?? [];
    list.push(row);
    byRegister.set(row.register_id, list);
  }
  return byRegister;
}

/** The runs matching `where` (over `run`, `cg`, `course`, `period`), with what the list shows. */
async function runRows(db: Db | Tx, where: SQL): Promise<RunRow[]> {
  const result = await db.execute<RunRow>(sql`
    select run.id as run_id, run.class_group_id, cg.code as class_group_code, cg.status as class_group_status,
      course.name as course_name, period.id as academic_period_id, period.name as academic_period_name,
      run.module, run.slots, run.teacher_id,
      (select coalesce(t.first_name || ' ' || t.last_name, nullif(run.teacher_name, ''))
        from "teachers" t where t.id = run.teacher_id) as teacher_name,
      run.module_ends_on::text as module_ends_on,
      (select count(*)::int from ${seatsOfRun(sql`run.id`)} and not exists (${CURRENT_GRADE_OF_SEAT})) as ungraded
    from "class_group_modules" run
    join "class_groups" cg on cg.id = run.class_group_id
    join "courses" course on course.id = cg.course_id
    join "academic_periods" period on period.id = cg.academic_period_id
    where run.deleted_at is null and ${where}
    order by cg.code asc, run.module asc nulls first`);
  return result.rows;
}

function viewOf(
  register: RegisterRow | null,
  run: { run_id: string; class_group_id: string; module_ends_on: string | null; ungraded: number },
  steps: StepRow[],
  hours: number,
  now: Date,
  virtualRound: number,
): GradeRegisterView {
  const status: GradeRegisterStatus = register?.status ?? "draft";
  const firstSubmitted = steps.find((step) => step.kind === "submitted") ?? null;
  // An open round runs on the run's date as it stands; a closed one keeps
  // the date it was sent against.
  const moduleEndsOn = status === "official" && firstSubmitted ? firstSubmitted.module_ends_on : run.module_ends_on;
  const deadlineAt = registerDeadline(moduleEndsOn, hours);
  const late = lateness({
    status,
    deadlineAt,
    firstSubmittedAt: firstSubmitted?.created_at ?? null,
    firstSubmittedEndsOn: firstSubmitted?.module_ends_on ?? null,
    hours,
    now,
  });
  const lastReturn = [...steps].reverse().find((step) => step.kind === "returned");
  return {
    registerId: register?.id ?? null,
    classGroupId: run.class_group_id,
    classGroupModuleId: run.run_id,
    round: register?.round ?? virtualRound,
    status,
    moduleEndsOn,
    deadlineAt,
    ...late,
    graded: register ? Number(register.graded) : 0,
    total: register ? Number(register.total) : Number(run.ungraded),
    returnNote: status === "returned" ? (lastReturn?.note ?? null) : null,
    steps: steps.map(
      (step): GradeRegisterStep => ({ kind: step.kind, at: step.created_at, byName: step.by_name, note: step.note }),
    ),
  };
}

/**
 * Every register of these runs, plus the round the next grade would open in
 * each run that has no open register but has ungraded seats. `currentOnly`
 * keeps, per run, the open round — or, when there is none to open, its latest.
 */
async function viewsOf(db: Db | Tx, runs: RunRow[], hours: number, now: Date, currentOnly: boolean) {
  if (runs.length === 0) return [];
  const registers = await registerRows(
    db,
    sql`r.class_group_module_id in (${sql.join(
      runs.map((run) => sql`${run.run_id}::uuid`),
      sql`, `,
    )})`,
  );
  const steps = await stepRows(
    db,
    registers.map((register) => register.id),
  );
  const out: Array<{ run: RunRow; view: GradeRegisterView }> = [];
  for (const run of runs) {
    const own = registers.filter((register) => register.class_group_module_id === run.run_id);
    const open = own.find((register) => register.status !== "official") ?? null;
    const nextRound = (own[0]?.round ?? 0) + 1;
    const views: GradeRegisterView[] = [];
    if (open) views.push(viewOf(open, run, steps.get(open.id) ?? [], hours, now, nextRound));
    else if (Number(run.ungraded) > 0 || own.length === 0) views.push(viewOf(null, run, [], hours, now, nextRound));
    for (const register of own) {
      if (register === open) continue;
      if (currentOnly && views.length > 0) break;
      views.push(viewOf(register, run, steps.get(register.id) ?? [], hours, now, nextRound));
    }
    for (const view of views) out.push({ run, view });
  }
  return out;
}

async function insertAudit(tx: Tx, entry: AuditLogEntry): Promise<void> {
  await tx.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    targetId: entry.targetId,
    metadata: entry.metadata ?? null,
    createdAt: entry.at,
  });
}

/** The run's open register, locked, with its counts — null when none is open. */
async function lockOpen(tx: Tx, classGroupModuleId: string): Promise<RegisterRow | null> {
  const [locked] = await tx
    .select({ id: gradeRegisters.id })
    .from(gradeRegisters)
    .where(and(eq(gradeRegisters.classGroupModuleId, classGroupModuleId), ne(gradeRegisters.status, "official")))
    .for("update");
  if (!locked) return null;
  const [row] = await registerRows(tx, sql`r.id = ${locked.id}`);
  return row ?? null;
}

class Refused extends Error {
  constructor(readonly outcome: Exclude<RegisterTransitionOutcome, { kind: "done" }>) {
    super(outcome.kind);
  }
}

export class DrizzleGradeRegisterRepository implements IGradeRegisterRepository {
  constructor(private readonly db: Db) {}

  async currentOf(classGroupModuleId: string, hours: number, now: Date): Promise<GradeRegisterView> {
    const runs = await runRows(this.db, sql`run.id = ${classGroupModuleId}`);
    const [first] = await viewsOf(this.db, runs, hours, now, true);
    if (!first) throw new Error("module run not found");
    return first.view;
  }

  async listForClassGroup(classGroupId: string, hours: number, now: Date): Promise<GradeRegisterView[]> {
    const runs = await runRows(this.db, sql`run.class_group_id = ${classGroupId}`);
    return (await viewsOf(this.db, runs, hours, now, false)).map((entry) => entry.view).filter(hasSeats);
  }

  async list(filters: GradeRegisterListFilters, hours: number, now: Date): Promise<GradeRegisterListRow[]> {
    // Only what is being graded: running or finished, on the catalog. Draft
    // and enrolling have no exam yet; closed is coordination's past (OOC-170).
    const where: SQL[] = [
      sql`cg.status in ('in_progress', 'finished')`,
      sql`cg.deleted_at is null`,
      sql`cg.erased_at is null`,
    ];
    if (filters.academicPeriodId) where.push(sql`cg.academic_period_id = ${filters.academicPeriodId}`);
    if (filters.teacherId) where.push(sql`run.teacher_id = ${filters.teacherId}`);
    if (filters.module !== null) where.push(sql`run.module = ${filters.module}`);
    const runs = await runRows(this.db, sql.join(where, sql` and `));
    return (await viewsOf(this.db, runs, hours, now, false))
      .filter(({ view }) => hasSeats(view))
      .filter(({ view }) => (filters.status ? view.status === filters.status : true))
      .filter(({ view }) => (filters.overdueOnly ? view.overdue : true))
      .map(
        ({ run, view }): GradeRegisterListRow => ({
          ...view,
          classGroupCode: run.class_group_code,
          classGroupStatus: run.class_group_status,
          courseName: run.course_name,
          academicPeriodId: run.academic_period_id,
          academicPeriodName: run.academic_period_name,
          module: run.module,
          slots: run.slots,
          teacherId: run.teacher_id,
          teacherName: run.teacher_name,
        }),
      );
  }

  private async step(
    classGroupModuleId: string,
    decide: (register: RegisterRow) => void,
    write: (tx: Tx, register: RegisterRow) => Promise<GradeRegisterStatus>,
  ): Promise<RegisterTransitionOutcome> {
    try {
      return await this.db.transaction(async (tx) => {
        const register = await lockOpen(tx, classGroupModuleId);
        if (!register) throw new Refused({ kind: "empty" });
        decide(register);
        const to = await write(tx, register);
        const moved = await tx
          .update(gradeRegisters)
          .set({ status: to, updatedAt: new Date() })
          .where(and(eq(gradeRegisters.id, register.id), eq(gradeRegisters.status, register.status)))
          .returning({ id: gradeRegisters.id });
        if (moved.length === 0) throw new Refused({ kind: "concurrent" });
        return { kind: "done", registerId: register.id } as const;
      });
    } catch (error) {
      if (error instanceof Refused) return error.outcome;
      throw error;
    }
  }

  async submit(params: Parameters<IGradeRegisterRepository["submit"]>[0]): Promise<RegisterTransitionOutcome> {
    return this.step(
      params.classGroupModuleId,
      (register) => {
        if (register.status !== "draft" && register.status !== "returned") {
          throw new Refused({ kind: "wrong_status", status: register.status });
        }
        assertComplete(register);
      },
      async (tx, register) => {
        await tx.insert(gradeRegisterEvents).values({
          registerId: register.id,
          kind: "submitted",
          // The run's end date as it stands now: what "sent late" is judged by.
          moduleEndsOn: sql`(select ends.module_ends_on from "class_group_modules" ends where ends.id = ${params.classGroupModuleId})`,
          actorId: params.actorId,
        });
        await insertAudit(tx, params.audit(register.id));
        return "in_review";
      },
    );
  }

  async returnToTeacher(
    params: Parameters<IGradeRegisterRepository["returnToTeacher"]>[0],
  ): Promise<RegisterTransitionOutcome> {
    return this.step(
      params.classGroupModuleId,
      (register) => {
        if (register.status !== "in_review") throw new Refused({ kind: "wrong_status", status: register.status });
      },
      async (tx, register) => {
        await tx.insert(gradeRegisterEvents).values({
          registerId: register.id,
          kind: "returned",
          note: params.note,
          actorId: params.actorId,
        });
        await insertAudit(tx, params.audit(register.id));
        return "returned";
      },
    );
  }

  async confirm(params: Parameters<IGradeRegisterRepository["confirm"]>[0]): Promise<RegisterTransitionOutcome> {
    return this.step(
      params.classGroupModuleId,
      (register) => assertComplete(register),
      async (tx, register) => {
        const graded = await tx.execute<{ enrollment_id: string; score: string | null; did_not_sit: boolean }>(sql`
          select held.enrollment_id, held.score, held.did_not_sit
          from "current_grades" held where held.register_id = ${register.id}`);
        const seats: ConfirmedSeat[] = graded.rows.map((row) => ({
          enrollmentId: row.enrollment_id,
          value: row.did_not_sit ? { kind: "did_not_sit" } : { kind: "score", score: Number(row.score) },
        }));
        const facts = await gradeEmailFactsOf(
          tx,
          register.class_group_id,
          seats.map((seat) => seat.enrollmentId),
        );
        await tx.insert(gradeRegisterEvents).values({ registerId: register.id, kind: "confirmed", actorId: params.actorId });
        await insertOutboxEmails(tx, params.emails(register.id, seats, facts));
        await insertAudit(tx, params.audit(register.id, seats));
        return "official";
      },
    );
  }
}

/** A round nothing was posted in and nobody sits is a run without students — not a register to show. */
function hasSeats(view: GradeRegisterView): boolean {
  return view.registerId !== null || view.total > 0;
}

/** A step needs the whole round graded — and something to be a round of. */
function assertComplete(register: RegisterRow): void {
  const graded = Number(register.graded);
  const missing = Number(register.total) - graded;
  if (graded === 0) throw new Refused({ kind: "empty" });
  if (missing > 0) throw new Refused({ kind: "incomplete", missing });
}
