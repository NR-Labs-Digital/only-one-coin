import { v7 as uuid } from "uuid";
import { z } from "zod";
import {
  BASE_PROPS_KEYS,
  SoftDeletableModel,
  SoftDeletableModelPropsSchema,
} from "../shared/base/SoftDeletableModel.js";
import { ModuleMaterialInvalidError, ModuleMaterialsIncompleteError } from "./errors.js";
import { LANDING_COURSE_KEYS, type LandingCourseKey } from "./landingCourseKeys.js";

/** How the certificate is earned (docs/REGRAS-NEGOCIO.md §6). */
export const CertificateRuleSchema = z.enum(["automatic", "exam_required"]);
export type CertificateRule = z.infer<typeof CertificateRuleSchema>;

/**
 * Which landing page sells this course (OOC-117). Null is a course the
 * landing does not link to — an enroll button with that key opens the
 * checkout with nothing chosen. One live course per key (unique index).
 */
export const LandingCourseKeySchema = z.enum(LANDING_COURSE_KEYS);

/**
 * Where a module's material may live (OOC-94): a Drive folder or file, or a
 * Docs/Slides/Sheets document. The link ends up as an href on a teacher's
 * screen, so anything else — another host, plain http, a look-alike — is
 * refused rather than rendered.
 */
export const MODULE_MATERIAL_HOSTS = ["drive.google.com", "docs.google.com"] as const;

function normalizeModuleMaterial(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch (cause) {
    throw new ModuleMaterialInvalidError({ cause });
  }
  if (url.protocol !== "https:" || !(MODULE_MATERIAL_HOSTS as readonly string[]).includes(url.hostname)) {
    throw new ModuleMaterialInvalidError();
  }
  return url.toString();
}

/** One valid link per module, normalized, in module order — or a refusal. */
export function normalizeModuleMaterials(modules: number, materials: readonly string[]): string[] {
  if (materials.length !== modules) throw new ModuleMaterialsIncompleteError();
  return materials.map(normalizeModuleMaterial);
}

/**
 * The material link of one module (OOC-100): what the teacher of a class
 * group teaching that module opens. Null when there is none to open — no
 * module set on the class group, a course from before OOC-94 with no
 * materials, or a module past a course since cut to fewer.
 */
export function materialOfModule(moduleMaterials: readonly string[], module: number | null): string | null {
  if (module === null || module < 1) return null;
  return moduleMaterials[module - 1] ?? null;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/**
 * What a row may hold. Looser than what may be written: courses that predate
 * OOC-36 carry `level = ''` and `summary = ''` (the columns landed with those
 * defaults), and courses that predate OOC-94 carry no module materials —
 * reading them back must not throw.
 */
export const CoursePropsSchema = SoftDeletableModelPropsSchema.extend({
  name: z.string().trim().min(1),
  language: z.string().trim().min(1),
  /** The Language record (OOC-128); `language` mirrors its name. Null only on a row nobody filed yet. */
  languageId: z.string().uuid().nullable().default(null),
  level: z.string(),
  summary: z.string(),
  minAge: z.number().int().positive(),
  modules: z.number().int().positive(),
  moduleMaterials: z.array(z.string()),
  totalHours: z.number().int().nonnegative(),
  certificateRule: CertificateRuleSchema,
  allowsFreeze: z.boolean(),
  allowsTransfer: z.boolean(),
  landingKey: LandingCourseKeySchema.nullable(),
});

export type CourseProps = z.infer<typeof CoursePropsSchema>;

/**
 * What coordination may change day to day (the options sheet). The module
 * materials travel with the module count: changing one means checking both.
 */
export const CourseOptionsSchema = z.object({
  minAge: z.number().int().positive(),
  modules: z.number().int().positive(),
  moduleMaterials: z.array(z.string()),
  totalHours: z.number().int().nonnegative(),
  certificateRule: CertificateRuleSchema,
  allowsFreeze: z.boolean(),
  allowsTransfer: z.boolean(),
});

/**
 * Opening a course. Level is required here even though old rows may lack it.
 * The summary is not (OOC-107): the backoffice form no longer asks for it, and
 * the portal hides "Sobre el curso" when it is blank. The column stays.
 */
export const CreateCourseSchema = CoursePropsSchema.omit(BASE_PROPS_KEYS).extend({
  level: z.string().trim().min(1),
  summary: z.string().trim().default(""),
  landingKey: LandingCourseKeySchema.nullable().default(null),
});

export type CreateCourseDTO = z.input<typeof CreateCourseSchema>;

export const UpdateCourseSchema = CreateCourseSchema.partial();
export type UpdateCourseDTO = z.infer<typeof UpdateCourseSchema>;

export class Course extends SoftDeletableModel {
  public name: string;
  public language: string;
  public languageId: string | null;
  public level: string;
  public summary: string;
  public minAge: number;
  public modules: number;
  /** One link per module, in order (OOC-94). Empty on a course that predates it. */
  public moduleMaterials: string[];
  public totalHours: number;
  public certificateRule: CertificateRule;
  public allowsFreeze: boolean;
  public allowsTransfer: boolean;
  public landingKey: LandingCourseKey | null;

  constructor(props: CourseProps) {
    super(props);
    this.name = props.name;
    this.language = props.language;
    this.languageId = props.languageId;
    this.level = props.level;
    this.summary = props.summary;
    this.minAge = props.minAge;
    this.modules = props.modules;
    this.moduleMaterials = props.moduleMaterials;
    this.totalHours = props.totalHours;
    this.certificateRule = props.certificateRule;
    this.allowsFreeze = props.allowsFreeze;
    this.allowsTransfer = props.allowsTransfer;
    this.landingKey = props.landingKey;
  }

  static create(dto: CreateCourseDTO): Course {
    const valid = CreateCourseSchema.parse(dto);
    const moduleMaterials = normalizeModuleMaterials(valid.modules, valid.moduleMaterials);
    return new Course(CoursePropsSchema.parse({ ...valid, moduleMaterials, id: uuid() }));
  }

  /**
   * Applies a validated patch and answers which fields actually changed — the
   * audit line names those, and an empty answer means there is nothing to
   * write.
   *
   * Module links are checked only when the module count or the links actually
   * change (OOC-94): a course that predates them keeps taking other edits, and
   * a patch that resends the same count asks for nothing. Checked before any
   * field is touched, so a refusal leaves the course as it was.
   */
  update(patch: UpdateCourseDTO): (keyof UpdateCourseDTO)[] {
    const valid = UpdateCourseSchema.parse(patch);

    const modulesChanged = valid.modules !== undefined && valid.modules !== this.modules;
    if (valid.moduleMaterials !== undefined || modulesChanged) {
      const modules = valid.modules ?? this.modules;
      const materials = valid.moduleMaterials ?? this.moduleMaterials;
      const resent = !modulesChanged && sameList(materials.map((link) => link.trim()), this.moduleMaterials);
      valid.moduleMaterials = resent ? this.moduleMaterials : normalizeModuleMaterials(modules, materials);
    }

    const changed: (keyof UpdateCourseDTO)[] = [];

    for (const key of Object.keys(valid) as (keyof UpdateCourseDTO)[]) {
      const next = valid[key];
      if (next === undefined || this[key] === next) continue;
      if (key === "moduleMaterials" && sameList(this.moduleMaterials, next as string[])) continue;
      (this as Record<string, unknown>)[key] = next;
      changed.push(key);
    }

    if (changed.length > 0) this.touch();
    return changed;
  }
}
