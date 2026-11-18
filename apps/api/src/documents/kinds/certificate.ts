import { LEGAL_IDENTITY } from "@ooc/domain";
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

/**
 * The course certificate (OOC-33): issued in coordination's batch, on the
 * module group of the course's last module. `finalGrade` is the last module's
 * grade as typed (`16.5`) — the one the certificate was granted on.
 */
export const certificateKind = defineTemplateKind({
  key: "certificate",
  format: "html",
  variables: z.object({
    student: IssuedStudentSchema,
    course: IssuedCourseSchema,
    classGroup: z.object({ code: z.string(), startsOn: z.string(), endsOn: z.string() }),
    finalGrade: z.string(),
    document: IssuedDocumentSchema,
    org: OrgSchema,
    issuedOn: z.string(),
  }),
  sample: {
    student: SAMPLE_STUDENT,
    course: SAMPLE_COURSE,
    classGroup: { code: "A-00042", startsOn: "2026-08-03", endsOn: "2026-11-13" },
    finalGrade: "16.5",
    document: SAMPLE_DOCUMENT,
    org: { ...LEGAL_IDENTITY },
    issuedOn: "2026-11-18",
  },
});

export type CertificateData = z.input<typeof certificateKind.variables>;

export const certificateStarterBody: string = copy.certificate.starterBody;
