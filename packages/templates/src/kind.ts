import { z } from "zod";

/**
 * What a template renders to. `html` escapes every value (a name with `<` in
 * it stays text); `text` does not — a subject line or a plain-text body would
 * otherwise show `&amp;` to the reader.
 */
export type TemplateFormat = "html" | "text";

/**
 * One kind of template the project fills — a teacher contract, a certificate,
 * an e-mail body. The kind owns the contract between the code and whoever
 * edits the text:
 *
 * - `variables` is the zod schema of what the code hands over. It is the only
 *   source of placeholders: the editor lists them from it, a template naming
 *   anything else is refused at check time, and data is parsed against it
 *   before every render.
 * - `sample` is what the preview fills the template with before there is a
 *   real record — checked against `variables` when the kind is defined, so a
 *   sample that drifted from the schema fails at startup, not in front of the
 *   person editing.
 *
 * Use `.describe()` on schema fields: the description is what the editor shows
 * next to each placeholder.
 */
export interface TemplateKind<Schema extends z.ZodTypeAny = z.ZodTypeAny> {
  key: string;
  format: TemplateFormat;
  variables: Schema;
  sample: z.input<Schema>;
}

export function defineTemplateKind<Schema extends z.ZodTypeAny>(kind: TemplateKind<Schema>): TemplateKind<Schema> {
  const parsed = kind.variables.safeParse(kind.sample);
  if (!parsed.success) {
    throw new Error(`Template kind "${kind.key}": the sample does not match its variables schema.`);
  }
  return kind;
}

export type PlaceholderType = "string" | "number" | "boolean" | "date" | "list" | "object";

/** One placeholder an editor can offer, e.g. `teacher.fullName`. */
export interface Placeholder {
  /** Dotted path as it is written in the template. Inside a list, items are `list[].field`. */
  path: string;
  type: PlaceholderType;
  /** From the schema's `.describe()`, when there is one. */
  description?: string;
  optional: boolean;
}

/** Wrappers that do not change what a value is, only whether it may be absent. */
export function unwrap(schema: z.ZodTypeAny): { inner: z.ZodTypeAny; optional: boolean } {
  let inner = schema;
  let optional = false;
  for (;;) {
    if (inner instanceof z.ZodOptional || inner instanceof z.ZodNullable) {
      optional = true;
      inner = inner.unwrap() as z.ZodTypeAny;
    } else if (inner instanceof z.ZodDefault) {
      inner = inner.removeDefault() as z.ZodTypeAny;
    } else if (inner instanceof z.ZodEffects) {
      inner = inner.innerType() as z.ZodTypeAny;
    } else if (inner instanceof z.ZodBranded || inner instanceof z.ZodReadonly) {
      inner = inner.unwrap() as z.ZodTypeAny;
    } else if (inner instanceof z.ZodPipeline) {
      inner = inner._def.out as z.ZodTypeAny;
    } else {
      return { inner, optional };
    }
  }
}

function typeOf(schema: z.ZodTypeAny): PlaceholderType {
  if (schema instanceof z.ZodObject) return "object";
  if (schema instanceof z.ZodArray) return "list";
  if (schema instanceof z.ZodNumber || schema instanceof z.ZodBigInt) return "number";
  if (schema instanceof z.ZodBoolean) return "boolean";
  if (schema instanceof z.ZodDate) return "date";
  return "string";
}

/**
 * Every placeholder a kind offers, in schema order — what the editor lists for
 * insertion. Objects list their fields; lists list their item fields as
 * `list[].field` (used inside `{% for item in list %}` as `item.field`).
 */
export function placeholdersOf(kind: TemplateKind): Placeholder[] {
  const out: Placeholder[] = [];

  function walk(schema: z.ZodTypeAny, path: string, parentOptional: boolean): void {
    const { inner, optional } = unwrap(schema);
    const description = schema.description ?? inner.description;
    const type = typeOf(inner);
    if (path) {
      out.push({ path, type, optional: parentOptional || optional, ...(description ? { description } : {}) });
    }
    if (inner instanceof z.ZodObject) {
      for (const [key, child] of Object.entries(inner.shape as Record<string, z.ZodTypeAny>)) {
        walk(child, path ? `${path}.${key}` : key, parentOptional || optional);
      }
    } else if (inner instanceof z.ZodArray) {
      const item = unwrap(inner.element as z.ZodTypeAny).inner;
      if (item instanceof z.ZodObject) {
        for (const [key, child] of Object.entries(item.shape as Record<string, z.ZodTypeAny>)) {
          walk(child, `${path}[].${key}`, parentOptional || optional);
        }
      }
    }
  }

  walk(kind.variables, "", false);
  return out;
}

/**
 * Whether a path the template reads (`["teacher", "fullName"]`) exists in the
 * schema. Lists accept an index, `first` and `last` (which step into the item)
 * and `size`; strings accept `size`. Anything else is a placeholder the code
 * never hands over.
 */
export function pathExists(schema: z.ZodTypeAny, segments: ReadonlyArray<string | number>): boolean {
  let current = unwrap(schema).inner;
  for (const segment of segments) {
    if (current instanceof z.ZodObject) {
      const child = (current.shape as Record<string, z.ZodTypeAny>)[String(segment)];
      if (!child) return false;
      current = unwrap(child).inner;
    } else if (current instanceof z.ZodArray) {
      if (segment === "size") return true;
      if (typeof segment === "number" || segment === "first" || segment === "last" || /^\d+$/.test(String(segment))) {
        current = unwrap(current.element as z.ZodTypeAny).inner;
      } else {
        return false;
      }
    } else if (current instanceof z.ZodString) {
      return segment === "size";
    } else {
      return false;
    }
  }
  return true;
}
