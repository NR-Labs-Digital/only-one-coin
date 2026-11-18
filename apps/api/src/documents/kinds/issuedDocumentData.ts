import { LEGAL_IDENTITY } from "@ooc/domain";
import { z } from "zod";
import copy from "../locales/es-PE.json" with { type: "json" };

/**
 * The parts both issued documents print (OOC-33): who, which course, and the
 * document's own code. Everything reaches the template as text it prints —
 * the document type spelled out, dates as calendar days (`YYYY-MM-DD`) for the
 * `local_date` filter — so whoever edits the text never formats anything.
 */
export const IssuedStudentSchema = z.object({
  fullName: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  documentType: z.string(),
  nationalId: z.string(),
});

export const IssuedCourseSchema = z.object({
  name: z.string(),
  language: z.string(),
  /** Empty when the course has none. */
  level: z.string(),
  /** Null when the course does not say (0 hours on file). */
  totalHours: z.number().int().nullable(),
});

export const IssuedDocumentSchema = z.object({ code: z.string() });
export const OrgSchema = z.object({ legalName: z.string(), ruc: z.string(), address: z.string() });

export const SAMPLE_STUDENT = {
  fullName: "María Fernanda Quispe Rojas",
  firstName: "María Fernanda",
  lastName: "Quispe Rojas",
  documentType: "DNI",
  nationalId: "71234567",
};
export const SAMPLE_COURSE = { name: "Inglés Básico", language: "Inglés", level: "A1", totalHours: 80 };
export const SAMPLE_DOCUMENT = { code: "OOC-7K4M-9QX2" };

/** The file as the issued documents read it. */
export interface StudentFacts {
  firstName: string;
  lastName: string;
  nationalIdType: string;
  nationalId: string;
}

export interface CourseFacts {
  name: string;
  language: string;
  level: string;
  totalHours: number;
}

export function issuedStudent(student: StudentFacts): z.infer<typeof IssuedStudentSchema> {
  const documentTypes: Record<string, string> = copy.nationalIdTypes;
  return {
    fullName: `${student.firstName} ${student.lastName}`,
    firstName: student.firstName,
    lastName: student.lastName,
    documentType: documentTypes[student.nationalIdType] ?? student.nationalIdType,
    nationalId: student.nationalId,
  };
}

export function issuedCourse(course: CourseFacts): z.infer<typeof IssuedCourseSchema> {
  return {
    name: course.name,
    language: course.language,
    level: course.level,
    totalHours: course.totalHours > 0 ? course.totalHours : null,
  };
}

export const org = () => ({ ...LEGAL_IDENTITY });

/** A timestamp as Lima's calendar day, `YYYY-MM-DD`; null stays null. */
export function limaDay(date: Date | null): string | null {
  return date ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(date) : null;
}
