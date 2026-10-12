import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import type { IStaffAccessRepository } from "../identity/ports/IStaffAccessRepository.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { TeacherNotFoundError } from "./errors.js";
import type { Teacher, TeacherStatus } from "./Teacher.js";
import type { ITeacherRepository } from "./TeacherRepository.js";

export interface SetTeacherRosterStatusInput {
  actorId: string;
  teacherId: string;
  status: TeacherStatus;
}

export interface SetTeacherRosterStatusOutput {
  teacher: Teacher;
  /**
   * Class groups still enrolling or running with this teacher. Leaving with
   * some open is allowed — somebody quitting mid-cycle is a real case, and
   * blocking would leave the file stuck (CLAUDE.md §1). The screen says so.
   */
  runningClassGroups: number;
}

/** The reason the panel account was closed — kept apart from "Quitar acceso". */
export const TEACHER_LEFT_ROSTER_BAN_REASON = "teacher_left_roster";

/**
 * Takes a teacher off the roster or puts them back (OOC-78). Leaving stops the
 * contract watch and deletes nothing (CLAUDE.md §1).
 *
 * It also closes the linked panel account, and rejoining opens it again
 * (decision of 12/10/2026): somebody who no longer teaches has no class group
 * to open, and an account left open is a door into student grades.
 */
export class SetTeacherRosterStatusUseCase extends BaseUseCase<
  SetTeacherRosterStatusInput,
  SetTeacherRosterStatusOutput
> {
  constructor(
    private readonly teachers: ITeacherRepository,
    private readonly staffAccess: IStaffAccessRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: SetTeacherRosterStatusInput): Promise<SetTeacherRosterStatusOutput> {
    const teacher = await this.teachers.findById(input.teacherId);
    if (!teacher) throw new TeacherNotFoundError();

    const runningClassGroups = await this.teachers.countRunningClassGroups(teacher.id);
    if (teacher.status === input.status) return { teacher, runningClassGroups };

    if (input.status === "inactive") teacher.leaveRoster();
    else teacher.rejoinRoster();

    const saved = await this.teachers.update(teacher);

    if (saved.userId) {
      if (input.status === "inactive") await this.staffAccess.ban(saved.userId, TEACHER_LEFT_ROSTER_BAN_REASON);
      else await this.staffAccess.unban(saved.userId);
    }

    await this.auditLog.append({
      actorId: input.actorId,
      action: input.status === "inactive" ? "teacher.left_roster" : "teacher.rejoined_roster",
      targetId: saved.id,
      metadata: { runningClassGroups, accountAccessChanged: saved.userId !== null },
      at: saved.updatedAt,
    });

    return { teacher: saved, runningClassGroups };
  }
}
