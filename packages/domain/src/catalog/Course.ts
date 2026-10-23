import { v7 as uuid } from "uuid";
import { z } from "zod";
import {
  BASE_PROPS_KEYS,
  SoftDeletableModel,
  SoftDeletableModelPropsSchema,
} from "../shared/base/SoftDeletableModel.js";
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
 * What a row may hold. Looser than what may be written: courses that predate
 * OOC-36 carry `level = ''` and `summary = ''` (the columns landed with those
 * defaults), and reading them back must not throw.
 */
export const CoursePropsSchema = SoftDeletableModelPropsSchema.extend({
  name: z.string().trim().min(1),
  language: z.string().trim().min(1),
  level: z.string(),
  summary: z.string(),
  minAge: z.number().int().positive(),
  modules: z.number().int().positive(),
  totalHours: z.number().int().nonnegative(),
  certificateRule: CertificateRuleSchema,
  allowsFreeze: z.boolean(),
  allowsTransfer: z.boolean(),
  landingKey: LandingCourseKeySchema.nullable(),
});

export type CourseProps = z.infer<typeof CoursePropsSchema>;

/** What coordination may change day to day (the options sheet). */
export const CourseOptionsSchema = z.object({
  minAge: z.number().int().positive(),
  modules: z.number().int().positive(),
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
  public level: string;
  public summary: string;
  public minAge: number;
  public modules: number;
  public totalHours: number;
  public certificateRule: CertificateRule;
  public allowsFreeze: boolean;
  public allowsTransfer: boolean;
  public landingKey: LandingCourseKey | null;

  constructor(props: CourseProps) {
    super(props);
    this.name = props.name;
    this.language = props.language;
    this.level = props.level;
    this.summary = props.summary;
    this.minAge = props.minAge;
    this.modules = props.modules;
    this.totalHours = props.totalHours;
    this.certificateRule = props.certificateRule;
    this.allowsFreeze = props.allowsFreeze;
    this.allowsTransfer = props.allowsTransfer;
    this.landingKey = props.landingKey;
  }

  static create(dto: CreateCourseDTO): Course {
    return new Course(CoursePropsSchema.parse({ ...CreateCourseSchema.parse(dto), id: uuid() }));
  }

  /**
   * Applies a validated patch and answers which fields actually changed — the
   * audit line names those, and an empty answer means there is nothing to
   * write.
   */
  update(patch: UpdateCourseDTO): (keyof UpdateCourseDTO)[] {
    const valid = UpdateCourseSchema.parse(patch);
    const changed: (keyof UpdateCourseDTO)[] = [];

    for (const key of Object.keys(valid) as (keyof UpdateCourseDTO)[]) {
      const next = valid[key];
      if (next === undefined || this[key] === next) continue;
      (this as Record<string, unknown>)[key] = next;
      changed.push(key);
    }

    if (changed.length > 0) this.touch();
    return changed;
  }
}
