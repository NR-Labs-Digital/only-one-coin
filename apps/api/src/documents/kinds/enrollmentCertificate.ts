import { defineTemplateKind } from "@ooc/templates";
import { z } from "zod";
import copy from "../locales/es-PE.json" with { type: "json" };
import {
  IssuedCourseSchema,
  IssuedDocumentSchema,
  IssuedStudentSchema,
  OrgSchema,
  SAMPLE_COURSE,
  SAMPLE_DOCUMENT,
  SAMPLE_STUDENT,
} from "./issuedDocumentData.js";
import { LEGAL_IDENTITY } from "@ooc/domain";

/**
 * The constancia de matrícula (OOC-33): issued for a paid procedure request
 * (OOC-83), about the enrollment it was asked for. Spanish only, like every
 * document of the institution (decision of 23/10/2026).
 */
export const enrollmentCertificateKind = defineTemplateKind({
  key: "enrollment_certificate",
  format: "html",
  variables: z.object({
    student: IssuedStudentSchema,
    course: IssuedCourseSchema,
    classGroup: z.object({
      code: z.string(),
      /** Which module the student is in now; null when the class group never set one. */
      module: z.number().int().nullable(),
      schedule: z.string(),
      startsOn: z.string(),
      endsOn: z.string(),
    }),
    period: z.object({ name: z.string() }),
    document: IssuedDocumentSchema,
    org: OrgSchema,
    issuedOn: z.string(),
  }),
  sample: {
    student: SAMPLE_STUDENT,
    course: SAMPLE_COURSE,
    classGroup: {
      code: "A-00042",
      module: 2,
      schedule: "Lun/Mié 19:00-20:30",
      startsOn: "2026-11-02",
      endsOn: "2026-12-18",
    },
    period: { name: "Ciclo 2026-II" },
    document: SAMPLE_DOCUMENT,
    org: { ...LEGAL_IDENTITY },
    issuedOn: "2026-11-18",
  },
});

export type EnrollmentCertificateData = z.input<typeof enrollmentCertificateKind.variables>;

export const enrollmentCertificateStarterBody: string = copy.enrollmentCertificate.starterBody;
