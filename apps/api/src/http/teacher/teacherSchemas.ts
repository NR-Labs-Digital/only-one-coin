import type { Teacher } from "@ooc/domain";
import { z } from "zod";
import { ClassGroupItemSchema } from "@/http/catalog/CatalogSchemas.js";
import type { TeacherDetail } from "@/infra/persistence/teacher/GetTeacherQuery.js";
import type { TeacherContractSummary, TeacherListRow } from "@/infra/persistence/teacher/ListTeachersQuery.js";

export const TeacherParamsSchema = z.object({ teacherId: z.string().uuid() });

const WeeklySlotResponseSchema = z.object({
  weekday: z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
  startTime: z.string(),
  endTime: z.string(),
});

export const TeacherContractResponseSchema = z.object({
  id: z.string().uuid(),
  recordedAt: z.string(),
  /** Calendar dates, `YYYY-MM-DD`. */
  startsAt: z.string(),
  endsAt: z.string(),
  /** The PDF of a contract filed under OOC-81 — opens via `…/file`. */
  file: z.object({ name: z.string(), sizeBytes: z.number().int() }).nullable(),
  /** The template version a generated contract prints from — via `…/document` (OOC-124). */
  templateVersion: z.number().int().nullable(),
});

export const TeacherRowResponseSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  nationalIdType: z.enum(["DNI", "CE", "passport"]),
  nationalId: z.string(),
  email: z.string(),
  phone: z.string(),
  status: z.enum(["active", "inactive"]),
  languages: z.array(z.string()),
  nationality: z.string(),
  country: z.string(),
  region: z.string().nullable(),
  city: z.string(),
  addressLine: z.string(),
  contract: TeacherContractResponseSchema.nullable(),
  contractDaysLeft: z.number().int().nullable(),
  activeClassGroups: z.number().int(),
  studentCount: z.number().int(),
  joinedAt: z.string(),
});

export const TeacherDetailResponseSchema = TeacherRowResponseSchema.extend({
  availability: z.array(WeeklySlotResponseSchema),
  classGroups: z.array(ClassGroupItemSchema),
  /** Every contract, newest first; the first is `contract` (OOC-81, OOC-124). */
  contracts: z.array(TeacherContractResponseSchema),
  /** The backoffice's alert window (OOC-41), for the contract badge. */
  contractAlertDays: z.number().int(),
});

/** What a write answers: the file as the server normalized it. */
export const TeacherRecordResponseSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  nationalIdType: z.enum(["DNI", "CE", "passport"]),
  nationalId: z.string(),
  email: z.string(),
  phone: z.string(),
  nationality: z.string(),
  country: z.string(),
  region: z.string().nullable(),
  city: z.string(),
  addressLine: z.string(),
  status: z.enum(["active", "inactive"]),
  languages: z.array(z.string()),
  availability: z.array(WeeklySlotResponseSchema),
});

const day = (date: Date) => date.toISOString().slice(0, 10);

export function serializeContract(contract: TeacherContractSummary) {
  return {
    id: contract.id,
    recordedAt: contract.recordedAt.toISOString(),
    startsAt: day(contract.startsOn),
    endsAt: day(contract.endsOn),
    file: contract.file,
    templateVersion: contract.templateVersion,
  };
}

export function serializeTeacherRow(row: TeacherListRow) {
  return {
    ...row,
    nationalIdType: row.nationalIdType as "DNI" | "CE" | "passport",
    contract: row.contract ? serializeContract(row.contract) : null,
    joinedAt: day(row.joinedAt),
  };
}

export function serializeTeacherDetail(detail: TeacherDetail) {
  return {
    ...serializeTeacherRow(detail),
    availability: detail.availability,
    classGroups: detail.classGroups,
    contracts: detail.contracts.map(serializeContract),
  };
}

export function serializeTeacher(teacher: Teacher) {
  return {
    id: teacher.id,
    firstName: teacher.firstName,
    lastName: teacher.lastName,
    nationalIdType: teacher.nationalIdType,
    nationalId: teacher.nationalId,
    email: teacher.email,
    phone: teacher.phone,
    nationality: teacher.nationality,
    country: teacher.country,
    region: teacher.region,
    city: teacher.city,
    addressLine: teacher.addressLine,
    status: teacher.status,
    languages: teacher.languages,
    availability: teacher.availability,
  };
}
