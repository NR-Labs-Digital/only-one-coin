import {
  CapacityBelowSeatsTakenError,
  PeriodAlreadyDuplicatedError,
  classGroupCodeOf,
  WaitlistAlreadyJoinedError,
  type AcademicPeriod,
  type AuditLogEntry,
  type ClassGroup,
  type Course,
  type IAcademicPeriodRepository,
  type IAuditLogRepository,
  type IClassGroupRepository,
  type ICourseRepository,
  type LandingCourseKey,
  type IPlanRepository,
  type IWaitlistRepository,
  type Plan,
  type PlanPrice,
  type WaitlistEntry,
  type WaitlistStudentStanding,
} from "@ooc/domain";

/**
 * In-memory stand-ins for the catalog ports. Shared by every catalog usecase
 * test so a port change breaks one fake, not five copies of it.
 */
export class FakeAuditLogRepository implements IAuditLogRepository {
  public readonly appended: AuditLogEntry[] = [];

  async append(entry: AuditLogEntry): Promise<void> {
    this.appended.push(entry);
  }
}

export class FakeCourseRepository implements ICourseRepository {
  public readonly rows = new Map<string, Course>();

  async create(course: Course): Promise<Course> {
    this.rows.set(course.id, course);
    return course;
  }

  async findById(id: string): Promise<Course | null> {
    return this.rows.get(id) ?? null;
  }

  async update(course: Course): Promise<Course> {
    this.rows.set(course.id, course);
    return course;
  }

  async findLiveByLandingKey(key: LandingCourseKey): Promise<Course | null> {
    return [...this.rows.values()].find((row) => row.landingKey === key && !row.isDeleted) ?? null;
  }

  async listLanguageSpellings(): Promise<string[]> {
    const uses = new Map<string, number>();
    for (const row of this.rows.values()) {
      if (!row.isDeleted) uses.set(row.language, (uses.get(row.language) ?? 0) + 1);
    }
    return [...uses].sort(([a, x], [b, y]) => y - x || a.localeCompare(b)).map(([language]) => language);
  }
}

export class FakePlanRepository implements IPlanRepository {
  public readonly plans = new Map<string, Plan>();
  public readonly prices: PlanPrice[] = [];

  async createWithPrice(plan: Plan, price: PlanPrice): Promise<void> {
    this.plans.set(plan.id, plan);
    this.prices.push(price);
  }

  async findById(id: string): Promise<Plan | null> {
    return this.plans.get(id) ?? null;
  }

  async rename(plan: Plan): Promise<void> {
    this.plans.set(plan.id, plan);
  }

  async addPrice(price: PlanPrice): Promise<void> {
    this.prices.push(price);
  }
}

export class FakeAcademicPeriodRepository implements IAcademicPeriodRepository {
  public readonly rows = new Map<string, AcademicPeriod>();

  async create(period: AcademicPeriod): Promise<AcademicPeriod> {
    this.rows.set(period.id, period);
    return period;
  }

  async findById(id: string): Promise<AcademicPeriod | null> {
    return this.rows.get(id) ?? null;
  }

  async update(period: AcademicPeriod): Promise<AcademicPeriod> {
    this.rows.set(period.id, period);
    return period;
  }
}

export class FakeClassGroupRepository implements IClassGroupRepository {
  public readonly rows = new Map<string, ClassGroup>();
  /** Lets a test simulate seats taken by the checkout between read and write. */
  public seatsTakenOverride = new Map<string, number>();
  private lastCode = 0;

  async nextCodes(count: number): Promise<string[]> {
    return Array.from({ length: count }, () => classGroupCodeOf(++this.lastCode));
  }

  async create(group: ClassGroup): Promise<ClassGroup> {
    this.rows.set(group.id, group);
    return group;
  }

  async findById(id: string): Promise<ClassGroup | null> {
    return this.rows.get(id) ?? null;
  }

  async update(group: ClassGroup): Promise<ClassGroup> {
    const taken = this.seatsTakenOverride.get(group.id) ?? group.seatsTaken;
    if (group.capacity < taken) throw new CapacityBelowSeatsTakenError();
    this.rows.set(group.id, group);
    return group;
  }

  async listForCopy(periodId: string): Promise<{ copyable: ClassGroup[]; skippedRetired: number }> {
    const inPeriod = [...this.rows.values()].filter((group) => group.academicPeriodId === periodId);
    return {
      copyable: inPeriod.filter((group) => !group.isDeleted),
      skippedRetired: inPeriod.filter((group) => group.isDeleted).length,
    };
  }

  async insertCopies(sourcePeriodId: string, targetPeriodId: string, copies: ClassGroup[]): Promise<void> {
    const already = [...this.rows.values()].some(
      (group) =>
        group.academicPeriodId === targetPeriodId &&
        group.sourceClassGroupId !== null &&
        this.rows.get(group.sourceClassGroupId)?.academicPeriodId === sourcePeriodId,
    );
    if (already) throw new PeriodAlreadyDuplicatedError();
    for (const copy of copies) this.rows.set(copy.id, copy);
  }
}

export class FakeWaitlistRepository implements IWaitlistRepository {
  /** Keyed `${studentId}:${classGroupId}`; absent means "free". */
  public readonly standing = new Map<string, WaitlistStudentStanding>();
  public readonly rows = new Map<string, WaitlistEntry>();

  async studentStanding(studentId: string, classGroupId: string): Promise<WaitlistStudentStanding> {
    return this.standing.get(`${studentId}:${classGroupId}`) ?? "free";
  }

  async join(entry: WaitlistEntry): Promise<WaitlistEntry> {
    const active = [...this.rows.values()].some(
      (row) => row.classGroupId === entry.classGroupId && row.studentId === entry.studentId && row.leftAt === null,
    );
    if (active) throw new WaitlistAlreadyJoinedError();
    this.rows.set(entry.id, entry);
    return entry;
  }

  async findById(id: string): Promise<WaitlistEntry | null> {
    return this.rows.get(id) ?? null;
  }

  async leave(entry: WaitlistEntry): Promise<void> {
    this.rows.set(entry.id, entry);
  }
}
