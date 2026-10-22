import type {
  CreateStaffInviteRecord,
  IFreshAuthVerifier,
  IStaffAccountProvisioner,
  IStaffInviteRepository,
  IStaffUserLookup,
  IUserRoleRepository,
  ProvisionStaffAccountInput,
  Role,
  StaffInvite,
} from "@ooc/domain";

/** In-memory stand-ins for the staff account ports, shared by the team usecase tests. */
export class FakeStaffUserLookup implements IStaffUserLookup {
  constructor(private readonly emails: string[] = []) {}

  async existsByEmail(email: string): Promise<boolean> {
    return this.emails.includes(email);
  }

  async findDisplayByUserId() {
    return null;
  }

  async findResettableStaffByEmail() {
    return null;
  }
}

export class FakeStaffInviteRepository implements IStaffInviteRepository {
  public readonly rows: StaffInvite[] = [];
  public readonly completed: { id: string; userId: string }[] = [];

  constructor(...onFile: StaffInvite[]) {
    this.rows.push(...onFile);
  }

  async create(record: CreateStaffInviteRecord): Promise<StaffInvite> {
    const invite: StaffInvite = {
      id: `inv_${this.rows.length + 1}`,
      email: record.email,
      firstName: record.firstName,
      lastName: record.lastName,
      role: record.role,
      token: record.token,
      status: "pending",
      teacherId: record.teacherId,
      expiresAt: record.expiresAt,
    };
    this.rows.push(invite);
    return invite;
  }

  async findPendingByEmail(email: string): Promise<StaffInvite | null> {
    return this.rows.find((row) => row.email === email && row.status === "pending") ?? null;
  }

  async findPendingByTeacherId(teacherId: string): Promise<StaffInvite | null> {
    return this.rows.find((row) => row.teacherId === teacherId && row.status === "pending") ?? null;
  }

  async findById(id: string): Promise<StaffInvite | null> {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  async findByToken(token: string): Promise<StaffInvite | null> {
    return this.rows.find((row) => row.token === token) ?? null;
  }

  async markCompleted(id: string, completedUserId: string): Promise<void> {
    const row = this.rows.find((invite) => invite.id === id);
    if (row) row.status = "completed";
    this.completed.push({ id, userId: completedUserId });
  }

  async markCancelled(id: string): Promise<void> {
    const row = this.rows.find((invite) => invite.id === id);
    if (row) row.status = "cancelled";
  }

  async renew(): Promise<void> {}
}

export class FakeStaffAccountProvisioner implements IStaffAccountProvisioner {
  public readonly provisioned: ProvisionStaffAccountInput[] = [];

  async provision(input: ProvisionStaffAccountInput) {
    this.provisioned.push(input);
    return { userId: `usr_${this.provisioned.length}` };
  }
}

export class FakeUserRoleRepository implements IUserRoleRepository {
  public readonly roles = new Map<string, Role>();

  async findRoleByUserId(userId: string): Promise<Role | null> {
    return this.roles.get(userId) ?? null;
  }

  async updateRole(userId: string, role: Role): Promise<void> {
    this.roles.set(userId, role);
  }
}

export class FakeFreshAuthVerifier implements IFreshAuthVerifier {
  async verify(): Promise<boolean> {
    return true;
  }
}
