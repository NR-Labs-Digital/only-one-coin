import {
  BOARD_ROLES,
  defaultPermissionsOf,
  isGrantable,
  type BoardRole,
  type CreateStaffInviteRecord,
  type EmailNotification,
  type IFreshAuthVerifier,
  type IStaffAccountProvisioner,
  type IStaffInviteRepository,
  type IStaffProfileRepository,
  type IStaffUserLookup,
  type IUserRoleRepository,
  type PermissionKey,
  type ProvisionStaffAccountInput,
  type Role,
  type StaffInvite,
  type StaffProfileListing,
  type StaffProfileRecord,
  type UserRoleAssignment,
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
  public readonly emails: EmailNotification[] = [];

  constructor(...onFile: StaffInvite[]) {
    this.rows.push(...onFile);
  }

  async create(
    record: CreateStaffInviteRecord,
    notify: (invite: StaffInvite) => EmailNotification[],
  ): Promise<StaffInvite> {
    const invite: StaffInvite = {
      id: `inv_${this.rows.length + 1}`,
      email: record.email,
      firstName: record.firstName,
      lastName: record.lastName,
      role: record.role,
      token: record.token,
      status: "pending",
      teacherId: record.teacherId,
      profileId: record.profileId,
      expiresAt: record.expiresAt,
    };
    this.rows.push(invite);
    this.emails.push(...notify(invite));
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
  public readonly profiles = new Map<string, string | null>();

  async findAssignmentByUserId(userId: string): Promise<UserRoleAssignment | null> {
    const role = this.roles.get(userId);
    return role ? { role, profileId: this.profiles.get(userId) ?? null } : null;
  }

  async updateAssignment(userId: string, assignment: UserRoleAssignment): Promise<void> {
    this.roles.set(userId, assignment.role);
    this.profiles.set(userId, assignment.profileId);
  }
}

/**
 * The cargos in memory (OOC-183): the board's, with their defaults, plus the
 * ones a test creates.
 */
export class FakeStaffProfileRepository implements IStaffProfileRepository {
  public readonly rows: (StaffProfileRecord & { retired?: boolean })[] = BOARD_ROLES.map((role) => ({
    id: `profile_${role}`,
    role,
    name: null,
    // As `syncBoard` stores them: only what a cargo is handed.
    permissions: defaultPermissionsOf(role).filter(isGrantable),
  }));
  public members = new Map<string, number>();

  async listLive(): Promise<StaffProfileListing[]> {
    return this.rows.filter((row) => !row.retired).map((row) => ({ ...row, members: this.members.get(row.id) ?? 0 }));
  }

  async findLiveById(id: string): Promise<StaffProfileRecord | null> {
    return this.rows.find((row) => row.id === id && !row.retired) ?? null;
  }

  async findByRole(role: BoardRole): Promise<StaffProfileRecord | null> {
    return this.rows.find((row) => row.role === role) ?? null;
  }

  async nameTaken(name: string, exceptId?: string): Promise<boolean> {
    return this.rows.some(
      (row) => !row.retired && row.id !== exceptId && row.name?.toLowerCase() === name.toLowerCase(),
    );
  }

  async create(input: { name: string; permissions: PermissionKey[]; createdBy: string }): Promise<StaffProfileRecord> {
    const row = { id: `profile_${this.rows.length + 1}`, role: null, name: input.name, permissions: input.permissions };
    this.rows.push(row);
    return row;
  }

  async update(id: string, input: { name?: string; permissions: PermissionKey[] }): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === id)!;
    if (input.name !== undefined) row.name = input.name;
    row.permissions = input.permissions;
  }

  async retire(id: string): Promise<void> {
    this.rows.find((row) => row.id === id)!.retired = true;
  }

  async countMembers(id: string): Promise<number> {
    return this.members.get(id) ?? 0;
  }
}

export class FakeFreshAuthVerifier implements IFreshAuthVerifier {
  async verify(): Promise<boolean> {
    return true;
  }
}
