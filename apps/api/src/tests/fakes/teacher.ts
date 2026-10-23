import type { IStaffAccessRepository, ITeacherRepository, NationalIdType, Teacher } from "@ooc/domain";

/** A detached copy, the way a row read back from the database would be. */
function copy<T extends object>(entity: T): T {
  return Object.assign(Object.create(Object.getPrototypeOf(entity) as object) as T, entity);
}

/** In-memory stand-in for the teacher port, shared by the teacher usecase tests. */
export class FakeTeacherRepository implements ITeacherRepository {
  public readonly rows = new Map<string, Teacher>();
  public readonly created: Teacher[] = [];
  public readonly updated: Teacher[] = [];
  /** Running class groups per teacher id. */
  public readonly running = new Map<string, number>();

  constructor(...onFile: Teacher[]) {
    for (const teacher of onFile) this.rows.set(teacher.id, copy(teacher));
  }

  async create(teacher: Teacher): Promise<Teacher> {
    this.rows.set(teacher.id, copy(teacher));
    this.created.push(teacher);
    return teacher;
  }

  async findById(id: string): Promise<Teacher | null> {
    const row = this.rows.get(id);
    return row ? copy(row) : null;
  }

  async findByNationalId(params: { nationalIdType: NationalIdType; nationalId: string }): Promise<Teacher | null> {
    for (const teacher of this.rows.values()) {
      if (teacher.nationalIdType === params.nationalIdType && teacher.nationalId === params.nationalId) {
        return copy(teacher);
      }
    }
    return null;
  }

  async findByUserId(userId: string): Promise<Teacher | null> {
    for (const teacher of this.rows.values()) {
      if (teacher.userId === userId) return copy(teacher);
    }
    return null;
  }

  /** Mirrors the adapter: writes only onto a live file with no account yet. */
  async linkAccount(teacherId: string, userId: string): Promise<boolean> {
    const row = this.rows.get(teacherId);
    if (!row || row.userId !== null) return false;
    row.userId = userId;
    return true;
  }

  async update(teacher: Teacher): Promise<Teacher> {
    this.rows.set(teacher.id, copy(teacher));
    this.updated.push(teacher);
    return teacher;
  }

  async countRunningClassGroups(teacherId: string): Promise<number> {
    return this.running.get(teacherId) ?? 0;
  }
}

export class FakeStaffAccessRepository implements IStaffAccessRepository {
  public readonly banned: { userId: string; reason: string }[] = [];
  public readonly unbanned: string[] = [];

  async ban(userId: string, reason: string): Promise<void> {
    this.banned.push({ userId, reason });
  }

  async unban(userId: string): Promise<void> {
    this.unbanned.push(userId);
  }
}
