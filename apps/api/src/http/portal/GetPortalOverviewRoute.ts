import { ForbiddenError, ProcedureKindSchema, type ProcedureRequestStatus } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { ClassroomLinkSchema, WeeklySlotSchema } from "@/http/catalog/CatalogSchemas.js";
import type { PortalPaymentRow } from "@/infra/persistence/portal/StudentPortalQuery.js";
import { PortalProfileQuerySchema, requestedProfile } from "./profileQuery.js";

const NationalIdTypeSchema = z.enum(["DNI", "CE", "passport"]);

const PortalPaymentSchema = z.object({
  id: z.string().uuid(),
  amountCents: z.number().int(),
  currency: z.literal("PEN"),
  method: z.enum(["yape", "plin", "bcp", "interbank", "other"]),
  methodDetail: z.string().nullable(),
  status: z.enum(["pending", "under_review", "approved", "rejected"]),
  operationNumber: z.string().nullable(),
  submittedAt: z.string(),
  settledAt: z.string().nullable(),
  hasReceipt: z.boolean(),
});

const PortalEnrollmentSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  status: z.enum(["under_review", "active", "completed", "rejected"]),
  seatStatus: z.enum(["reserved", "confirmed", "released"]),
  createdAt: z.string(),
  course: z.object({
    name: z.string(),
    summary: z.string(),
    level: z.string(),
    minAge: z.number().int(),
    requiresCertificationExam: z.boolean(),
  }),
  classGroup: z.object({
    name: z.string(),
    teacherName: z.string(),
    slots: z.array(WeeklySlotSchema),
    startsOn: z.string().nullable(),
    endsOn: z.string().nullable(),
    /** One Classroom per module the class group teaches (OOC-144) — empty unless the seat is confirmed. */
    classroomLinks: z.array(ClassroomLinkSchema),
  }),
  academicPeriodName: z.string(),
  plan: z.object({ name: z.string(), priceId: z.string().uuid(), priceCents: z.number().int(), currency: z.literal("PEN") }),
  payments: z.array(PortalPaymentSchema),
  /** The final grade posted by the teacher (OOC-38): `grade` null on a DA; null while nothing is posted. */
  finalGrade: z.object({ grade: z.number().nullable(), didNotSit: z.boolean(), recordedAt: z.string() }).nullable(),
});

const PortalOverviewSchema = z.object({
  /** The profile shown (OOC-147): the one `?profile=` named among the account's own, or the newest. */
  profileId: z.string().uuid(),
  /** Every person the account reaches — one per child for a guardian. */
  profiles: z.array(z.object({ id: z.string().uuid(), firstName: z.string(), lastName: z.string() })),
  student: z.object({
    firstName: z.string(),
    lastName: z.string(),
    nationalIdType: NationalIdTypeSchema,
    nationalId: z.string(),
    email: z.string(),
    phone: z.string(),
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    isMinor: z.boolean(),
    guardian: z
      .object({
        firstName: z.string(),
        lastName: z.string(),
        relationship: z.enum(["mother", "father", "legal_guardian"]),
        nationalIdType: NationalIdTypeSchema,
        nationalId: z.string(),
        email: z.string(),
        phone: z.string(),
        // The version and the date, never the IP: it is the guardian's
        // record, and the student's screen has no use for it.
        consent: z.object({ version: z.string(), acceptedAt: z.string() }).nullable(),
      })
      .nullable(),
  }),
  enrollments: z.array(PortalEnrollmentSchema),
  /** The pass mark the screen compares a grade with (OOC-41); null when it could not be read. */
  passingGrade: z.number().int().nullable(),
  procedures: z.array(
    z.object({
      kind: ProcedureKindSchema,
      priceCents: z.number().int(),
      currency: z.literal("PEN"),
      eligible: z.array(z.object({ enrollmentId: z.string().uuid(), courseName: z.string() })),
    }),
  ),
  requests: z.array(
    z.object({
      id: z.string().uuid(),
      kind: ProcedureKindSchema,
      status: z.enum(["under_review", "in_progress", "completed", "rejected"]),
      courseName: z.string(),
      createdAt: z.string(),
      priceCents: z.number().int(),
      currency: z.literal("PEN"),
      payment: PortalPaymentSchema,
    }),
  ),
});

/** The request as the student reads it: while the money waits, `pending` and
 * `under_review` are one state, the same as on the Payments screen. */
function requestStageOf(status: ProcedureRequestStatus): "under_review" | "in_progress" | "completed" | "rejected" {
  switch (status) {
    case "requested":
      return "under_review";
    case "paid":
      return "in_progress";
    case "fulfilled":
      return "completed";
    case "rejected":
      return "rejected";
  }
}

const toIso = (value: Date | null) => value?.toISOString() ?? null;

const toPortalPayment = (payment: PortalPaymentRow) => ({
  id: payment.id,
  amountCents: payment.amountCents,
  currency: "PEN" as const,
  method: payment.method as z.infer<typeof PortalPaymentSchema>["method"],
  methodDetail: payment.methodDetail,
  status: payment.status as z.infer<typeof PortalPaymentSchema>["status"],
  operationNumber: payment.operationNumber,
  submittedAt: payment.submittedAt.toISOString(),
  settledAt: toIso(payment.settledAt),
  hasReceipt: payment.hasReceipt,
});

/**
 * Everything the student portal shows about one profile of the signed-in
 * account (OOC-32; profiles OOC-147) — the file, guardian, enrollments and
 * every payment. `?profile=` picks the profile among the account's own. Scoped by the session's
 * account, never by an id from the client (CLAUDE.md §8). Same 403 as
 * `GET /portal/me` for a student account no file points at.
 */
export const getPortalOverviewRoute = RouteBuilder.get("/portal/overview")
  .docs({
    tags: ["Portal"],
    summary: "The signed-in student's portal data",
    description: "Backs every screen of the student portal: file, guardian, enrollments, payments and paid procedures.",
  })
  .roles("student")
  .query(PortalProfileQuerySchema)
  .response(200, PortalOverviewSchema)
  .response(403, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const overview = await container.queries.studentPortal.overview(request.currentUser!.id, requestedProfile(request.query));
    if (!overview) {
      throw new ForbiddenError({ reason: "portal.no_student_record", message: "No student file is linked to this account.", path: request.url });
    }
    const { student } = overview;

    reply.status(200).send({
      profileId: overview.profileId,
      profiles: overview.profiles,
      student: {
        firstName: student.firstName,
        lastName: student.lastName,
        nationalIdType: student.nationalIdType as z.infer<typeof NationalIdTypeSchema>,
        nationalId: student.nationalId,
        email: student.email,
        phone: student.phone,
        // A calendar date, stored as UTC midnight (BirthDateField): sent as
        // `YYYY-MM-DD` so the screen prints it as written — read as an
        // instant in America/Lima it lands on the day before.
        birthDate: student.birthDate.toISOString().slice(0, 10),
        isMinor: student.isMinor,
        guardian: student.guardian
          ? {
              firstName: student.guardian.firstName,
              lastName: student.guardian.lastName,
              relationship: student.guardian.relationship as "mother" | "father" | "legal_guardian",
              nationalIdType: student.guardian.nationalIdType as z.infer<typeof NationalIdTypeSchema>,
              nationalId: student.guardian.nationalId,
              email: student.guardian.email,
              phone: student.guardian.phone,
              consent: student.guardian.consent
                ? { version: student.guardian.consent.version, acceptedAt: student.guardian.consent.acceptedAt.toISOString() }
                : null,
            }
          : null,
      },
      enrollments: overview.enrollments.map((enrollment) => ({
        id: enrollment.id,
        code: enrollment.code,
        status: enrollment.status,
        seatStatus: enrollment.seatStatus as "reserved" | "confirmed" | "released",
        createdAt: enrollment.createdAt.toISOString(),
        course: enrollment.course,
        classGroup: {
          name: enrollment.classGroup.name,
          teacherName: enrollment.classGroup.teacherName,
          // A legacy class group carries no structured slots (its schedule
          // is only the text column), so an unreadable value is no slots.
          slots: z.array(WeeklySlotSchema).catch([]).parse(enrollment.classGroup.slots),
          startsOn: toIso(enrollment.classGroup.startsOn),
          endsOn: toIso(enrollment.classGroup.endsOn),
          classroomLinks: enrollment.classGroup.classroomLinks,
        },
        academicPeriodName: enrollment.academicPeriodName,
        plan: { ...enrollment.plan, currency: "PEN" as const },
        payments: enrollment.payments.map(toPortalPayment),
        finalGrade: enrollment.finalGrade
          ? {
              grade: enrollment.finalGrade.score,
              didNotSit: enrollment.finalGrade.didNotSit,
              recordedAt: enrollment.finalGrade.recordedAt.toISOString(),
            }
          : null,
      })),
      passingGrade: overview.passingGrade,
      procedures: overview.procedures.map((procedure) => ({ ...procedure, currency: "PEN" as const })),
      requests: overview.requests.map((item) => ({
        id: item.id,
        kind: item.kind,
        status: requestStageOf(item.status),
        courseName: item.courseName,
        createdAt: item.createdAt.toISOString(),
        priceCents: item.amountCents,
        currency: "PEN" as const,
        payment: toPortalPayment(item.payment),
      })),
    });
  });
