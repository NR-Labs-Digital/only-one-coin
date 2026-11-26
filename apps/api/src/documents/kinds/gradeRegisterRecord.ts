import { LEGAL_IDENTITY } from "@ooc/domain";
import { defineTemplateKind } from "@ooc/templates";
import { z } from "zod";
import copy from "../locales/es-PE.json" with { type: "json" };
import { IssuedCourseSchema, OrgSchema, SAMPLE_COURSE } from "./issuedDocumentData.js";

/**
 * The teacher's acta de notas (OOC-176): the record of an official grade
 * register, what the teacher is paid against. Replaces the confirmation
 * e-mail Coordinación/Asesoría sent by hand.
 *
 * Two kinds of data reach the template. **Frozen** when the acta is first
 * downloaded (`grade_register_records.data`): the teacher, the class group,
 * the course, the module, the period, who confirmed and when, and the legal
 * identity. **Live**, read on every print: the counts, the passing grade,
 * the day a grade was corrected after official (decision of 26/11/2026 with
 * Miguel, to confirm with the client — the acta always shows today's
 * numbers), and the print date.
 *
 * Spanish only, like every document of the engine (decision of 23/10/2026).
 */
export const GradeRegisterRecordFrozenSchema = z.object({
  teacher: z.object({
    fullName: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    /** Null while the teacher has not completed the file (OOC-103). */
    documentType: z.string().nullable(),
    nationalId: z.string().nullable(),
  }),
  classGroup: z.object({ code: z.string(), startsOn: z.string(), endsOn: z.string() }),
  course: IssuedCourseSchema,
  period: z.object({ name: z.string() }),
  /** The module group: "Módulo 2", or the class group's own label without a module. */
  module: z.object({ number: z.number().int().nullable(), label: z.string(), round: z.number().int() }),
  confirmed: z.object({ byName: z.string(), on: z.string() }),
  org: OrgSchema,
});

export const GradeRegisterRecordLiveSchema = z.object({
  counts: z.object({
    students: z.number().int(),
    passed: z.number().int(),
    failed: z.number().int(),
    didNotSit: z.number().int(),
  }),
  /** As typed in Configuración (`14`, `13.5`). */
  passingGrade: z.string(),
  /** `YYYY-MM-DD` of the last correction after the register became official; null when none. */
  correctedOn: z.string().nullable(),
  issuedOn: z.string(),
});

export type GradeRegisterRecordFrozen = z.infer<typeof GradeRegisterRecordFrozenSchema>;
export type GradeRegisterRecordLive = z.infer<typeof GradeRegisterRecordLiveSchema>;

export const gradeRegisterRecordKind = defineTemplateKind({
  key: "grade_register_record",
  format: "html",
  variables: GradeRegisterRecordFrozenSchema.merge(GradeRegisterRecordLiveSchema),
  sample: {
    teacher: {
      fullName: "Ana María Quispe Peña",
      firstName: "Ana María",
      lastName: "Quispe Peña",
      documentType: "DNI",
      nationalId: "12345678",
    },
    classGroup: { code: "A-00042", startsOn: "2026-08-03", endsOn: "2026-11-13" },
    course: SAMPLE_COURSE,
    period: { name: "Ciclo Agosto 2026" },
    module: { number: 2, label: "Módulo 2", round: 1 },
    confirmed: { byName: "Milagros Seminario", on: "2026-11-16" },
    org: { ...LEGAL_IDENTITY },
    counts: { students: 28, passed: 22, failed: 4, didNotSit: 2 },
    passingGrade: "14",
    correctedOn: null,
    issuedOn: "2026-11-18",
  },
});

export type GradeRegisterRecordData = z.input<typeof gradeRegisterRecordKind.variables>;

export const gradeRegisterRecordStarterBody: string = copy.gradeRegisterRecord.starterBody;

/** "Módulo 2" — the label the acta prints for a module group. */
export function moduleLabel(module: number | null): string {
  return module === null ? copy.gradeRegisterRecord.noModule : `${copy.gradeRegisterRecord.module} ${module}`;
}
