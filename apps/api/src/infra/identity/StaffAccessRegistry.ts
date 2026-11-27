import {
  BOARD_ROLES,
  defaultPermissionsOf,
  isBoardRole,
  profilePermissions,
  profileRequiresMfa,
  type BoardRole,
  type PermissionKey,
  type Role,
  type StaffProfileRecord,
} from "@ooc/domain";

/** Who is asking, as far as its cargo goes. */
export interface StaffAccessSubject {
  role: Role;
  profileId?: string | null;
}

interface Resolved {
  permissions: ReadonlySet<PermissionKey>;
  mfaRequired: boolean;
}

const NOTHING: Resolved = { permissions: new Set(), mfaRequired: false };

function resolve(profile: Pick<StaffProfileRecord, "role" | "permissions">): Resolved {
  return { permissions: profilePermissions(profile), mfaRequired: profileRequiresMfa(profile) };
}

/**
 * What every cargo can do, held in memory (OOC-183). The authorization hook
 * asks it on every request, so it answers synchronously; the database is read
 * on boot, after every write this process makes (`reload`), and every
 * `refreshMs` for writes another machine made — blue-green keeps two alive
 * for a moment.
 *
 * Until it is loaded it answers with the board's defaults — what every cargo
 * held before cargos became data — and a `custom` account reaches nothing.
 * That is also what the test suite runs against, with no database.
 */
export class StaffAccessRegistry {
  private byRole = new Map<BoardRole, Resolved>(
    BOARD_ROLES.map((role) => [role, resolve({ role, permissions: defaultPermissionsOf(role) })]),
  );
  private byProfileId = new Map<string, Resolved>();
  private timer: NodeJS.Timeout | null = null;

  /**
   * `loadRetiredRoles` names the board cargos administration retired: their
   * rows are gone from `load`, and without it they would fall back to the
   * board's defaults — a retired cargo must hold nothing.
   */
  constructor(
    private readonly load: () => Promise<StaffProfileRecord[]>,
    private readonly loadRetiredRoles: () => Promise<BoardRole[]> = async () => [],
  ) {}

  permissionsOf(subject: StaffAccessSubject): ReadonlySet<PermissionKey> {
    return this.resolved(subject).permissions;
  }

  has(subject: StaffAccessSubject, permission: PermissionKey): boolean {
    return this.permissionsOf(subject).has(permission);
  }

  requiresMfa(subject: StaffAccessSubject): boolean {
    return this.resolved(subject).mfaRequired;
  }

  async reload(): Promise<void> {
    const [profiles, retiredRoles] = await Promise.all([this.load(), this.loadRetiredRoles()]);
    const byRole = new Map<BoardRole, Resolved>(
      BOARD_ROLES.map((role) => [role, resolve({ role, permissions: defaultPermissionsOf(role) })]),
    );
    const byProfileId = new Map<string, Resolved>();
    for (const role of retiredRoles) byRole.set(role, NOTHING);
    for (const profile of profiles) {
      if (profile.role) byRole.set(profile.role, resolve(profile));
      else byProfileId.set(profile.id, resolve(profile));
    }
    this.byRole = byRole;
    this.byProfileId = byProfileId;
  }

  /** Re-reads every `refreshMs`; a failed read keeps the last good copy. */
  startRefreshing(refreshMs: number, onError: (err: unknown) => void): void {
    this.stopRefreshing();
    this.timer = setInterval(() => {
      this.reload().catch(onError);
    }, refreshMs);
    this.timer.unref();
  }

  stopRefreshing(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private resolved(subject: StaffAccessSubject): Resolved {
    if (subject.role === "custom") {
      return (subject.profileId ? this.byProfileId.get(subject.profileId) : undefined) ?? NOTHING;
    }
    return isBoardRole(subject.role) ? (this.byRole.get(subject.role) ?? NOTHING) : NOTHING;
  }
}
