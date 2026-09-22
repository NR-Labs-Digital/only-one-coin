import {
  CatalogEntryNotFoundError,
  RestoreCatalogEntryUseCase,
  RetireCatalogEntryUseCase,
  type AuditLogEntry,
  type CatalogEntryKind,
  type CatalogEntryState,
  type IAuditLogRepository,
  type ICatalogEntryRepository,
} from "@ooc/domain";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * Taking something off the shelf (CLAUDE.md §6 — retiring is marking, never
 * erasing). The catalog is the only place where the meaning is unambiguous: a
 * retired course is not offered any more, and everything that already happened
 * on it stays exactly where it was.
 *
 * The rule under test that is easy to get backwards: an entry with live
 * enrollments **can** be retired. It follows the precedent §1 already set for
 * a teacher leaving the roster — "avisa, não bloqueia — quem larga no meio do
 * ciclo é caso real, e travar deixaria a ficha presa". So the usecase reports
 * how many live enrollments the entry still carries; it does not refuse.
 *
 * Pure domain: the repository and the audit log are fakes, no database.
 */

const ACTOR = "usr_admin";
const A_COURSE = "018f2b5c-0000-7000-8000-00000000c001";
const A_CLASS_GROUP = "018f2b5c-0000-7000-8000-00000000c002";

class FakeCatalogEntryRepository implements ICatalogEntryRepository {
  constructor(private readonly entries: Map<string, CatalogEntryState>) {}

  private static key(kind: CatalogEntryKind, id: string): string {
    return `${kind}:${id}`;
  }

  async find(kind: CatalogEntryKind, id: string): Promise<CatalogEntryState | null> {
    return this.entries.get(FakeCatalogEntryRepository.key(kind, id)) ?? null;
  }

  async retire(kind: CatalogEntryKind, id: string, at: Date): Promise<void> {
    const entry = this.entries.get(FakeCatalogEntryRepository.key(kind, id));
    if (entry) entry.retiredAt = at;
  }

  async restore(kind: CatalogEntryKind, id: string): Promise<void> {
    const entry = this.entries.get(FakeCatalogEntryRepository.key(kind, id));
    if (entry) entry.retiredAt = null;
  }
}

class FakeAuditLogRepository implements IAuditLogRepository {
  public readonly appended: AuditLogEntry[] = [];

  async append(entry: AuditLogEntry): Promise<void> {
    this.appended.push(entry);
  }
}

function entry(overrides: Partial<CatalogEntryState> & Pick<CatalogEntryState, "kind" | "id">): CatalogEntryState {
  return { retiredAt: null, liveEnrollments: 0, ...overrides };
}

let repository: FakeCatalogEntryRepository;
let auditLog: FakeAuditLogRepository;
let retire: RetireCatalogEntryUseCase;
let restore: RestoreCatalogEntryUseCase;

beforeEach(() => {
  const entries = new Map<string, CatalogEntryState>([
    [`course:${A_COURSE}`, entry({ kind: "course", id: A_COURSE })],
    [`class_group:${A_CLASS_GROUP}`, entry({ kind: "class_group", id: A_CLASS_GROUP, liveEnrollments: 12 })],
  ]);

  repository = new FakeCatalogEntryRepository(entries);
  auditLog = new FakeAuditLogRepository();
  retire = new RetireCatalogEntryUseCase(repository, auditLog);
  restore = new RestoreCatalogEntryUseCase(repository, auditLog);
});

describe("RetireCatalogEntryUseCase", () => {
  it("takes a course off the shelf", async () => {
    const result = await retire.run({ actorId: ACTOR, kind: "course", id: A_COURSE });

    expect(result.retiredAt).toBeInstanceOf(Date);
    expect(await repository.find("course", A_COURSE)).toMatchObject({ retiredAt: result.retiredAt });
  });

  it("retires an entry that still has live enrollments, and says how many", async () => {
    const result = await retire.run({ actorId: ACTOR, kind: "class_group", id: A_CLASS_GROUP });

    expect(result.retiredAt).not.toBeNull();
    expect(result.liveEnrollments).toBe(12);
  });

  it("appends one audit entry naming what was retired", async () => {
    await retire.run({ actorId: ACTOR, kind: "class_group", id: A_CLASS_GROUP });

    expect(auditLog.appended).toHaveLength(1);
    expect(auditLog.appended[0]).toMatchObject({
      actorId: ACTOR,
      action: "catalog.retired",
      targetId: A_CLASS_GROUP,
      metadata: { kind: "class_group", liveEnrollments: 12 },
    });
  });

  // Same shape as the domain's own softDelete(): retiring twice is not an
  // error and the first date is the one that is true.
  it("keeps the first retirement date and writes no second audit entry", async () => {
    const first = await retire.run({ actorId: ACTOR, kind: "course", id: A_COURSE });
    const second = await retire.run({ actorId: ACTOR, kind: "course", id: A_COURSE });

    expect(second.retiredAt).toEqual(first.retiredAt);
    expect(auditLog.appended).toHaveLength(1);
  });

  it("refuses an entry that is not on file", async () => {
    await expect(
      retire.run({ actorId: ACTOR, kind: "plan", id: "018f2b5c-0000-7000-8000-0000000000ff" }),
    ).rejects.toBeInstanceOf(CatalogEntryNotFoundError);
  });
});

describe("RestoreCatalogEntryUseCase", () => {
  // Without this, a mistaken click would be unfixable: §6 leaves no DELETE
  // and §7 leaves no hand-run SQL, so the only way back would be a migration.
  it("brings a retired entry back", async () => {
    await retire.run({ actorId: ACTOR, kind: "course", id: A_COURSE });

    const result = await restore.run({ actorId: ACTOR, kind: "course", id: A_COURSE });

    expect(result.retiredAt).toBeNull();
    expect(await repository.find("course", A_COURSE)).toMatchObject({ retiredAt: null });
  });

  it("appends one audit entry for the restore", async () => {
    await retire.run({ actorId: ACTOR, kind: "course", id: A_COURSE });
    await restore.run({ actorId: ACTOR, kind: "course", id: A_COURSE });

    expect(auditLog.appended.map((row) => row.action)).toEqual(["catalog.retired", "catalog.restored"]);
  });

  it("writes nothing when the entry was never retired", async () => {
    const result = await restore.run({ actorId: ACTOR, kind: "course", id: A_COURSE });

    expect(result.retiredAt).toBeNull();
    expect(auditLog.appended).toHaveLength(0);
  });

  it("refuses an entry that is not on file", async () => {
    await expect(
      restore.run({ actorId: ACTOR, kind: "academic_period", id: "018f2b5c-0000-7000-8000-0000000000ff" }),
    ).rejects.toBeInstanceOf(CatalogEntryNotFoundError);
  });
});
