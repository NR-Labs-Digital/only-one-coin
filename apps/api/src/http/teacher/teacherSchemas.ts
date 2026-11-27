import {
  CreateTeacherSchema,
  PendingTeacherDataSchema,
  TeacherDataSchema,
  type CreateTeacherDTO,
  type PendingTeacherDataDTO,
  type Teacher,
  type TeacherDataDTO,
} from "@ooc/domain";
import { z } from "zod";
import { ClassGroupItemSchema } from "@/http/catalog/CatalogSchemas.js";
import type { TeacherDetail } from "@/infra/persistence/teacher/GetTeacherQuery.js";
import type { TeacherContractSummary, TeacherListRow } from "@/infra/persistence/teacher/ListTeachersQuery.js";

export const TeacherParamsSchema = z.object({ teacherId: z.string().uuid() });

/**
 * Parses `body` with `schema`, reporting its issues on `ctx` with their own
 * paths — so a body picked between two shapes still names the field it got
 * wrong, which a `z.union` would fold into one `invalid_union`.
 */
function parseInto<T extends z.ZodTypeAny>(schema: T, body: unknown, ctx: z.RefinementCtx): z.output<T> | typeof z.NEVER {
  const result = schema.safeParse(body);
  if (result.success) return result.data as z.output<T>;
  for (const issue of result.error.issues) ctx.addIssue(issue as z.IssueData);
  return z.NEVER;
}

/**
 * `POST /teachers` (OOC-103): the whole file, or — with `onboarding: true` —
 * name, personal e-mail, Classroom account and languages only, for the
 * teacher to complete after the invite.
 */
export const RegisterTeacherBodySchema = z
  .object({ onboarding: z.boolean().optional() })
  .passthrough()
  .transform(
    (body, ctx):
      | { onboarding: true; teacher: PendingTeacherDataDTO }
      | { onboarding: false; teacher: CreateTeacherDTO } =>
      body.onboarding === true
        ? { onboarding: true, teacher: parseInto(PendingTeacherDataSchema, body, ctx) }
        : { onboarding: false, teacher: parseInto(CreateTeacherSchema, body, ctx) },
  );

/**
 * `PUT /teachers/:id`: the whole file minus the week — or, on a file still
 * pending onboarding (OOC-103), without the profile. A body with no document
 * is read as the pending shape; the usecase refuses it on a complete file.
 */
export const UpdateTeacherBodySchema = z
  .object({ nationalId: z.unknown().optional() })
  .passthrough()
  .transform((body, ctx): TeacherDataDTO | PendingTeacherDataDTO =>
    typeof body.nationalId === "string" && body.nationalId.trim() !== ""
      ? parseInto(TeacherDataSchema, body, ctx)
      : parseInto(PendingTeacherDataSchema, body, ctx),
  );

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
  /** Profile fields: null on a file still pending onboarding (OOC-103). */
  nationalIdType: z.enum(["DNI", "CE", "passport"]).nullable(),
  nationalId: z.string().nullable(),
  email: z.string(),
  personalEmail: z.string().nullable(),
  /** The shared Classroom login (OOC-196) — e-mail only; the password has its own route. */
  classroomAccount: z.object({ id: z.string().uuid(), email: z.string() }).nullable(),
  phone: z.string().nullable(),
  status: z.enum(["active", "inactive"]),
  languages: z.array(z.string()),
  nationality: z.string().nullable(),
  country: z.string().nullable(),
  region: z.string().nullable(),
  city: z.string().nullable(),
  addressLine: z.string().nullable(),
  profileComplete: z.boolean(),
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
  nationalIdType: z.enum(["DNI", "CE", "passport"]).nullable(),
  nationalId: z.string().nullable(),
  email: z.string(),
  personalEmail: z.string().nullable(),
  classroomAccountId: z.string().uuid().nullable(),
  phone: z.string().nullable(),
  nationality: z.string().nullable(),
  country: z.string().nullable(),
  region: z.string().nullable(),
  city: z.string().nullable(),
  addressLine: z.string().nullable(),
  profileComplete: z.boolean(),
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
    nationalIdType: row.nationalIdType as "DNI" | "CE" | "passport" | null,
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
    personalEmail: teacher.personalEmail,
    classroomAccountId: teacher.classroomAccountId,
    phone: teacher.phone,
    nationality: teacher.nationality,
    country: teacher.country,
    region: teacher.region,
    city: teacher.city,
    addressLine: teacher.addressLine,
    profileComplete: teacher.profileComplete,
    status: teacher.status,
    languages: teacher.languages,
    availability: teacher.availability,
  };
}
