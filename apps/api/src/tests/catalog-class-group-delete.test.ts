import {
  DeleteClassGroupsUseCase,
  MAX_CLASS_GROUPS_PER_DELETE,
  type ClassGroupDeleteOutcome,
  type IClassGroupDeletionRepository,
} from "@ooc/domain";
import { describe, expect, it } from "vitest";

/** Answers from a script, and remembers what it was asked. */
class ScriptedDeletions implements IClassGroupDeletionRepository {
  readonly asked: string[] = [];
  constructor(private readonly script: Record<string, ClassGroupDeleteOutcome>) {}
  delete(params: { id: string }): Promise<ClassGroupDeleteOutcome> {
    this.asked.push(params.id);
    return Promise.resolve(this.script[params.id] ?? { outcome: "not_found" });
  }
}

describe("deleting class groups (23/11/2026)", () => {
  it("answers each id on its own: deleted, erased or not found", async () => {
    const deletions = new ScriptedDeletions({
      a: { outcome: "deleted" },
      b: { outcome: "erased", reason: "enrollments" },
      c: { outcome: "deleted" },
    });

    const results = await new DeleteClassGroupsUseCase(deletions).run({ actorId: "usr", ids: ["a", "b", "c", "d"] });

    expect(results).toEqual([
      { id: "a", outcome: "deleted" },
      { id: "b", outcome: "erased", reason: "enrollments" },
      { id: "c", outcome: "deleted" },
      { id: "d", outcome: "not_found" },
    ]);
  });

  it("deletes a repeated id once", async () => {
    const deletions = new ScriptedDeletions({ a: { outcome: "deleted" } });

    const results = await new DeleteClassGroupsUseCase(deletions).run({ actorId: "usr", ids: ["a", "a"] });

    expect(deletions.asked).toEqual(["a"]);
    expect(results).toHaveLength(1);
  });

  it("never goes past the request limit, whatever reaches it", async () => {
    const deletions = new ScriptedDeletions({});
    const ids = Array.from({ length: MAX_CLASS_GROUPS_PER_DELETE + 5 }, (_, i) => `id-${i}`);

    await new DeleteClassGroupsUseCase(deletions).run({ actorId: "usr", ids });

    expect(deletions.asked).toHaveLength(MAX_CLASS_GROUPS_PER_DELETE);
  });
});
