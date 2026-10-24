import { Liquid, Tag, type Template, type TagToken, type TopLevelToken, type Variable } from "liquidjs";
import type { z } from "zod";
import { DEFAULT_TIME_ZONE, localDate, money, type TemplateLocale } from "./filters.js";
import { pathExists, type TemplateKind } from "./kind.js";

/**
 * Why a template was refused, as a code — never a sentence: the editor
 * translates it (CLAUDE.md §4). `line`/`column` are 1-based, where the editor
 * can underline the problem.
 */
export type TemplateIssueCode =
  /** Liquid that does not parse: an unclosed tag, a stray `{{`. */
  | "syntax_error"
  /** A placeholder the kind does not offer — `variable` says which. */
  | "unknown_variable"
  /** A filter that does not exist — `filter` says which. */
  | "unknown_filter"
  /** `include`, `render`, `layout` or `block`: they read files, and a template here stands alone. */
  | "forbidden_tag"
  /** Longer than `maxSourceLength`. */
  | "too_large";

export interface TemplateIssue {
  code: TemplateIssueCode;
  line?: number;
  column?: number;
  /** For `unknown_variable`: the path as written, e.g. `teacher.fullname`. */
  variable?: string;
  /** For `unknown_filter`. */
  filter?: string;
}

export type TemplateCheck =
  | { ok: true; /** Every placeholder path the template reads, once each. */ variables: string[] }
  | { ok: false; issues: TemplateIssue[] };

/** Why a render failed. The template itself was already checked; these are about the data or the limits. */
export type TemplateRenderErrorCode =
  /** The template does not pass `check` — render never runs an unchecked template. */
  | "invalid_template"
  /** The data does not match the kind's schema. */
  | "invalid_data"
  /** A value the template reads is absent in this record (e.g. an optional field left empty). */
  | "missing_value"
  /** Took longer, or built more, than the engine allows. */
  | "limit_exceeded"
  /** Anything else — a filter or engine bug. Logged by the caller, never shown raw. */
  | "render_failed";

export class TemplateRenderError extends Error {
  constructor(
    public readonly code: TemplateRenderErrorCode,
    public readonly detail?: { issues?: TemplateIssue[]; dataIssues?: z.ZodIssue[]; variable?: string },
  ) {
    super(`Template render failed: ${code}`);
    this.name = "TemplateRenderError";
  }
}

export interface RenderContext {
  locale: TemplateLocale;
  /** IANA zone instants are shown in. Defaults to America/Lima. */
  timeZone?: string;
}

export interface TemplateEngineOptions {
  /** Longest template source accepted, in characters. */
  maxSourceLength?: number;
  /** Longest a single render may run, in milliseconds. */
  renderLimitMs?: number;
  /** Rough cap on what a render may allocate (Liquid's own accounting). */
  memoryLimit?: number;
}

const FORBIDDEN_TAGS = ["include", "render", "layout", "block"] as const;

/** Where the render context reaches the filters — a name no schema can declare. */
const CONTEXT_KEY = "__ooc_render_context__";

/**
 * The project's template engine: Liquid (LiquidJS), locked down for text that
 * people edit in the backoffice and the code fills in.
 *
 * - **Only the kind's placeholders.** `check` reads every variable the template
 *   uses (static analysis — no render) and refuses one the kind's schema does
 *   not offer; `render` never runs a template that fails `check`.
 * - **No file access.** `include`/`render`/`layout`/`block` are refused at
 *   parse time; a template is one self-contained text.
 * - **Escaped by default** for `html` kinds: a value can never inject markup.
 * - **Strict:** an unknown filter fails the check; a value missing at render
 *   fails the render instead of leaving a silent blank in a contract.
 * - **Bounded:** source length, render time and memory are capped.
 * - **Our formatting:** `money` (integer cents → PEN) and `local_date`
 *   (calendar day as is, instants in America/Lima), both in the render locale.
 */
export class TemplateEngine {
  private readonly html: Liquid;
  private readonly text: Liquid;
  private readonly maxSourceLength: number;

  constructor(options: TemplateEngineOptions = {}) {
    this.maxSourceLength = options.maxSourceLength ?? 100_000;
    const common = {
      strictVariables: true,
      // …except where the template is asking whether the value exists:
      // `{% if teacher.phone %}` and `| default:` must work on an optional
      // field, or nothing optional could ever be guarded.
      lenientIf: true,
      strictFilters: true,
      // No file system: partials are refused by the tags below, and nothing
      // else may resolve a path either.
      relativeReference: false,
      root: [],
      partials: [],
      layouts: [],
      parseLimit: this.maxSourceLength,
      renderLimit: options.renderLimitMs ?? 1_000,
      memoryLimit: options.memoryLimit ?? 10_000_000,
    };
    this.html = this.configure(new Liquid({ ...common, outputEscape: "escape" }));
    this.text = this.configure(new Liquid(common));
  }

  private configure(liquid: Liquid): Liquid {
    for (const name of FORBIDDEN_TAGS) {
      liquid.registerTag(
        name,
        class extends Tag {
          constructor(token: TagToken, remainTokens: TopLevelToken[], engine: Liquid) {
            super(token, remainTokens, engine);
            throw new ForbiddenTagError(name, token);
          }
          *render(): Generator<unknown, void, unknown> {}
        },
      );
    }
    liquid.registerFilter("money", function (this: { context: { globals: Record<string, unknown> } }, value: unknown) {
      const ctx = this.context.globals[CONTEXT_KEY] as Required<RenderContext>;
      return money(value, ctx.locale);
    });
    liquid.registerFilter(
      "local_date",
      function (this: { context: { globals: Record<string, unknown> } }, value: unknown, style?: unknown) {
        const ctx = this.context.globals[CONTEXT_KEY] as Required<RenderContext>;
        return localDate(value, style, ctx.locale, ctx.timeZone);
      },
    );
    return liquid;
  }

  private liquidFor(kind: TemplateKind): Liquid {
    return kind.format === "html" ? this.html : this.text;
  }

  /**
   * Checks a template against its kind without rendering it — what saving an
   * edit runs. Collects every problem it can, so the editor can mark them all.
   */
  check(kind: TemplateKind, source: string): TemplateCheck {
    if (source.length > this.maxSourceLength) return { ok: false, issues: [{ code: "too_large" }] };

    let templates: Template[];
    try {
      templates = this.liquidFor(kind).parse(source);
    } catch (error) {
      return { ok: false, issues: [parseIssue(error)] };
    }

    const analysis = this.liquidFor(kind).analyzeSync(templates, { partials: false });
    const issues: TemplateIssue[] = [];
    const used = new Set<string>();
    for (const occurrences of Object.values(analysis.globals)) {
      for (const variable of occurrences) {
        const segments = staticSegments(variable);
        const path = variable.toString();
        if (pathExists(kind.variables, segments)) {
          used.add(segments.join("."));
        } else {
          issues.push({
            code: "unknown_variable",
            variable: path,
            line: variable.location.row,
            column: variable.location.col,
          });
        }
      }
    }

    return issues.length > 0 ? { ok: false, issues } : { ok: true, variables: [...used].sort() };
  }

  /**
   * Renders a checked template with data parsed against the kind's schema.
   * Throws `TemplateRenderError` — never a raw Liquid error — so a caller can
   * answer with a code.
   */
  async render(kind: TemplateKind, source: string, data: unknown, context: RenderContext): Promise<string> {
    const check = this.check(kind, source);
    if (!check.ok) throw new TemplateRenderError("invalid_template", { issues: check.issues });

    const parsed = kind.variables.safeParse(data);
    if (!parsed.success) throw new TemplateRenderError("invalid_data", { dataIssues: parsed.error.issues });

    const liquid = this.liquidFor(kind);
    try {
      return await liquid.parseAndRender(source, parsed.data as Record<string, unknown>, {
        globals: { [CONTEXT_KEY]: { locale: context.locale, timeZone: context.timeZone ?? DEFAULT_TIME_ZONE } },
      });
    } catch (error) {
      throw renderError(error);
    }
  }

  /** The kind's sample data, rendered — what the editor's preview shows before a real record is picked. */
  renderSample(kind: TemplateKind, source: string, context: RenderContext): Promise<string> {
    return this.render(kind, source, kind.sample, context);
  }
}

class ForbiddenTagError extends Error {
  constructor(
    public readonly tag: string,
    public readonly token: TagToken,
  ) {
    super(`forbidden tag: ${tag}`);
  }
}

/** Static segments of a variable; a dynamic index (`list[i]`) ends the walk there. */
function staticSegments(variable: Variable): Array<string | number> {
  const out: Array<string | number> = [];
  for (const segment of variable.segments) {
    if (typeof segment === "string" || typeof segment === "number") out.push(segment);
    else break;
  }
  return out;
}

interface LiquidLikeError {
  name?: string;
  message?: string;
  token?: { getPosition?: () => [number, number] };
  originalError?: unknown;
}

function position(error: LiquidLikeError): { line?: number; column?: number } {
  const at = error.token?.getPosition?.();
  return at ? { line: at[0], column: at[1] } : {};
}

function parseIssue(error: unknown): TemplateIssue {
  const err = error as LiquidLikeError;
  const cause = (err.originalError ?? err) as LiquidLikeError & { tag?: string };
  if (cause instanceof ForbiddenTagError) return { code: "forbidden_tag", ...position(cause) };

  const filter = /undefined filter: ([\w-]+)/.exec(err.message ?? "");
  if (filter) return { code: "unknown_filter", filter: filter[1], ...position(err) };

  return { code: "syntax_error", ...position(err) };
}

function renderError(error: unknown): TemplateRenderError {
  const err = error as LiquidLikeError;
  if (err.name === "UndefinedVariableError") {
    const variable = /undefined variable: ([\w.[\]"']+)/.exec(err.message ?? "")?.[1];
    return new TemplateRenderError("missing_value", variable ? { variable } : undefined);
  }
  if (/limit exceeded/i.test(err.message ?? "")) return new TemplateRenderError("limit_exceeded");
  // A bug in a filter or in the engine itself — still never a raw Liquid
  // error to the caller.
  return new TemplateRenderError("render_failed");
}
