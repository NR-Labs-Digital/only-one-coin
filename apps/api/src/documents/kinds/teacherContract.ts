import { LEGAL_IDENTITY, type Teacher } from "@ooc/domain";
import { defineTemplateKind } from "@ooc/templates";
import { z } from "zod";
import copy from "../locales/es-PE.json" with { type: "json" };

/**
 * The teacher contract (OOC-123, the first document of the engine). Spanish
 * only — a Peruvian legal document (decision of 23/10/2026). The schema is the
 * whole list of placeholders the editor offers; the editor's labels for them
 * live in the app's locale files, keyed by path.
 *
 * Everything reaches the template already as text the contract prints —
 * country names in Spanish, the document type spelled out, the languages
 * joined — so whoever edits the text never has to format anything. Dates are
 * calendar days (`YYYY-MM-DD`) for the `local_date` filter.
 */
export const teacherContractKind = defineTemplateKind({
  key: "teacher_contract",
  format: "html",
  variables: z.object({
    teacher: z.object({
      fullName: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      documentType: z.string(),
      nationalId: z.string(),
      nationality: z.string(),
      email: z.string(),
      phone: z.string(),
      address: z.string(),
      city: z.string(),
      region: z.string().nullable(),
      country: z.string(),
      languages: z.string(),
    }),
    contract: z.object({ startsOn: z.string(), endsOn: z.string() }),
    org: z.object({ legalName: z.string(), ruc: z.string(), address: z.string() }),
    issuedOn: z.string(),
  }),
  sample: {
    teacher: {
      fullName: "Ana María Quispe Peña",
      firstName: "Ana María",
      lastName: "Quispe Peña",
      documentType: "DNI",
      nationalId: "12345678",
      nationality: "Perú",
      email: "ana.quispe@example.com",
      phone: "+51 900 000 000",
      address: "Av. Arequipa 1234, Lince",
      city: "Lima",
      region: "Lima",
      country: "Perú",
      languages: "Inglés y Francés",
    },
    contract: { startsOn: "2026-11-01", endsOn: "2027-10-31" },
    org: { ...LEGAL_IDENTITY },
    issuedOn: "2026-10-31",
  },
});

export type TeacherContractData = z.input<typeof teacherContractKind.variables>;

export const teacherContractStarterBody: string = copy.teacherContract.starterBody;

const countryNames = new Intl.DisplayNames(["es-PE"], { type: "region" });

/** "Inglés", "Inglés y Francés", "Inglés, Francés e Italiano". */
const joinLanguages = new Intl.ListFormat("es-PE", { style: "long", type: "conjunction" });

/** Today's calendar day in Lima, `YYYY-MM-DD`. */
export function todayInLima(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(now);
}

/** A teacher file, as the contract template reads it. */
export function teacherContractData(
  teacher: Teacher,
  contract: { startsOn: string; endsOn: string },
  now: Date = new Date(),
): TeacherContractData {
  const documentTypes: Record<string, string> = copy.nationalIdTypes;
  return {
    teacher: {
      fullName: `${teacher.firstName} ${teacher.lastName}`,
      firstName: teacher.firstName,
      lastName: teacher.lastName,
      documentType: documentTypes[teacher.nationalIdType] ?? teacher.nationalIdType,
      nationalId: teacher.nationalId,
      nationality: countryNames.of(teacher.nationality) ?? teacher.nationality,
      email: teacher.email,
      phone: teacher.phone,
      address: teacher.addressLine,
      city: teacher.city,
      region: teacher.region,
      country: countryNames.of(teacher.country) ?? teacher.country,
      languages: joinLanguages.format(teacher.languages),
    },
    contract,
    org: { ...LEGAL_IDENTITY },
    issuedOn: todayInLima(now),
  };
}
