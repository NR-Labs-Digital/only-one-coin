import {
  TeacherContractAlreadyFiledError,
  type IStaffAccessRepository,
  type ITeacherContractRepository,
  type ITeacherContractStorage,
  type ITeacherRepository,
  type NationalIdType,
  type Teacher,
  type TeacherContract,
} from "@ooc/domain";

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

/** In-memory `teacher_contracts`, append-only like the table. */
export class FakeTeacherContractRepository implements ITeacherContractRepository {
  public readonly rows: TeacherContract[] = [];

  async create(contract: TeacherContract): Promise<TeacherContract> {
    if (this.rows.some((row) => row.id === contract.id || row.objectKey === contract.objectKey)) {
      throw new TeacherContractAlreadyFiledError();
    }
    this.rows.push(contract);
    return contract;
  }

  async findForTeacher(teacherId: string, contractId: string): Promise<TeacherContract | null> {
    return this.rows.find((row) => row.id === contractId && row.teacherId === teacherId) ?? null;
  }
}

/** The bucket, as a map of key → bytes. */
export class FakeTeacherContractStorage implements ITeacherContractStorage {
  public readonly objects = new Map<string, Uint8Array>();
  public readonly targets: { objectKey: string; contentType: string; maxBytes: number }[] = [];
  public readonly deleted: string[] = [];
  public readonly downloads: { objectKey: string; fileName: string; expiresInSeconds: number }[] = [];

  async createUploadTarget(params: { objectKey: string; contentType: string; maxBytes: number }) {
    this.targets.push(params);
    return { url: "https://bucket.example.com", fields: { key: params.objectKey } };
  }

  public readonly reads: string[] = [];

  async size(objectKey: string) {
    return this.objects.get(objectKey)?.length ?? null;
  }

  async read(objectKey: string) {
    this.reads.push(objectKey);
    return this.objects.get(objectKey) ?? new Uint8Array();
  }

  async delete(objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
    this.deleted.push(objectKey);
  }

  async createDownloadUrl(params: { objectKey: string; fileName: string; expiresInSeconds: number }) {
    this.downloads.push(params);
    return `https://bucket.example.com/${params.objectKey}?signed`;
  }
}
