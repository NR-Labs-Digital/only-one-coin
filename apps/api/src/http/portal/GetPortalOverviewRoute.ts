import { ForbiddenError } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { WeeklySlotSchema } from "@/http/catalog/CatalogSchemas.js";

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
    /** The Google Classroom (OOC-98) — null unless the seat is confirmed. */
    classroomUrl: z.string().nullable(),
  }),
  academicPeriodName: z.string(),
  plan: z.object({ name: z.string(), priceId: z.string().uuid(), priceCents: z.number().int(), currency: z.literal("PEN") }),
  payments: z.array(PortalPaymentSchema),
});

const PortalOverviewSchema = z.object({
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
});

const toIso = (value: Date | null) => value?.toISOString() ?? null;

/**
 * Everything the student portal shows about the signed-in student (OOC-32) —
 * their file, guardian, enrollments and every payment. Scoped by the session's
 * account, never by an id from the client (CLAUDE.md §8). Same 403 as
 * `GET /portal/me` for a student account no file points at.
 */
export const getPortalOverviewRoute = RouteBuilder.get("/portal/overview")
  .docs({
    tags: ["Portal"],
    summary: "The signed-in student's portal data",
    description: "Backs every screen of the student portal: file, guardian, enrollments and payments.",
  })
  .roles("student")
  .response(200, PortalOverviewSchema)
  .response(403, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const overview = await container.queries.studentPortal.overview(request.currentUser!.id);
    if (!overview) {
      throw new ForbiddenError({ reason: "portal.no_student_record", message: "No student file is linked to this account.", path: request.url });
    }
    const { student } = overview;

    reply.status(200).send({
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
          classroomUrl: enrollment.classGroup.classroomUrl,
        },
        academicPeriodName: enrollment.academicPeriodName,
        plan: { ...enrollment.plan, currency: "PEN" as const },
        payments: enrollment.payments.map((payment) => ({
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
        })),
      })),
    });
  });
