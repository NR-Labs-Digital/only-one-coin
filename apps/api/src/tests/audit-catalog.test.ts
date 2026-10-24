import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  AUDIT_ACTIONS,
  AUDIT_FIELDS,
  AUDITED_PLATFORM_SETTINGS,
  CreateGuardianSchema,
  PLATFORM_SETTING_COLUMNS,
  StudentFieldsSchema,
  TeacherFieldsSchema,
  UpdateAcademicPeriodSchema,
  UpdateClassGroupSchema,
  UpdateCourseSchema,
  auditEntityOf,
  auditFieldsOf,
  storedActionsOf,
} from "@ooc/domain";
import { describe, expect, it } from "vitest";

/**
 * OOC-122: the general audit log names every entry through the catalogue in
 * `packages/domain/src/identity/auditCatalog.ts`. An action written without a
 * catalogue entry still lists, as "unknown" — this suite is what keeps that
 * from happening quietly: it reads every `action:` the code writes.
 */

const ROOTS = [resolve(__dirname, "../../../../packages/domain/src"), resolve(__dirname, "..")];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "tests" || name === "scripts" ? [] : sourceFiles(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

/** Every dotted string literal in the expression after an `action:` — ternaries included. */
function writtenActions(): Set<string> {
  const found = new Set<string>();
  for (const file of ROOTS.flatMap(sourceFiles)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\baction:\s*([^,\n}]+)/g)) {
      for (const literal of match[1]!.matchAll(/"([a-z_]+(?:\.[a-z_]+)+)"/g)) found.add(literal[1]!);
    }
  }
  return found;
}

/** An object schema's keys, through a refinement wrapper if there is one. */
function shapeOf(schema: unknown): Record<string, unknown> {
  const node = schema as { shape?: Record<string, unknown>; _def?: { schema?: unknown; innerType?: unknown } };
  if (node.shape) return node.shape;
  const inner = node._def?.schema ?? node._def?.innerType;
  if (!inner) throw new Error("not an object schema");
  return shapeOf(inner);
}

describe("audit catalogue", () => {
  it("names every action the code writes", () => {
    const written = writtenActions();
    expect(written.size).toBeGreaterThan(40);
    const missing = [...written].filter((action) => !(action in AUDIT_ACTIONS));
    expect(missing).toEqual([]);
  });

  it("covers every platform setting column, each its own action", () => {
    expect([...AUDITED_PLATFORM_SETTINGS].sort()).toEqual(Object.values(PLATFORM_SETTING_COLUMNS).sort());
    for (const column of AUDITED_PLATFORM_SETTINGS) {
      expect(column in AUDIT_FIELDS, column).toBe(true);
    }
  });

  it("labels every field an edit can record", () => {
    const editable = [
      StudentFieldsSchema,
      CreateGuardianSchema,
      TeacherFieldsSchema,
      UpdateCourseSchema,
      UpdateClassGroupSchema,
      UpdateAcademicPeriodSchema,
    ].flatMap((schema) => Object.keys(shapeOf(schema)));
    const missing = editable.filter((name) => name !== "studentId" && !(name in AUDIT_FIELDS));
    expect(missing).toEqual([]);
  });

  it("resolves the entity of a retired entry from its kind", () => {
    expect(auditEntityOf("catalog.retired", "plan")).toBe("course");
    expect(auditEntityOf("catalog.restored", "class_group")).toBe("class_group");
    expect(auditEntityOf("catalog.retired", null)).toBeNull();
    expect(auditEntityOf("payment.approved", null)).toBe("payment");
    expect(auditEntityOf("something.unheard_of", null)).toBeNull();
  });

  it("expands one screen key into every stored action behind it", () => {
    expect(storedActionsOf("platform_setting_updated")).toHaveLength(AUDITED_PLATFORM_SETTINGS.length);
    expect(storedActionsOf("payment_approved")).toEqual(["payment.approved"]);
  });

  it("keeps field names, drops what it cannot label", () => {
    expect(auditFieldsOf(["firstName", "nationalId", "firstName", "secretThing", 3])).toEqual(["first_name", "id_number"]);
    expect(auditFieldsOf(null)).toEqual([]);
  });
});
