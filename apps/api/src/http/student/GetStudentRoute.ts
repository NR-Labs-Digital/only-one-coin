import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { NotFoundError } from "@ooc/domain";
import { container } from "@/container.js";
import { STUDENT_FILE_ROLES } from "./studentRoles.js";

const GetStudentParamsSchema = z.object({
  studentId: z.string().uuid(),
});

const GuardianResponseSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  relationship: z.enum(["mother", "father", "legal_guardian"]),
  nationalIdType: z.enum(["DNI", "CE", "passport"]),
  nationalId: z.string(),
  email: z.string(),
  phone: z.string(),
  consent: z.object({ version: z.string(), acceptedAt: z.string(), ip: z.string() }).nullable(),
});

const EnrollmentHistoryItemSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  status: z.enum(["under_review", "active", "completed", "rejected"]),
  seatStatus: z.enum(["reserved", "confirmed", "released"]),
  createdAt: z.string(),
  courseName: z.string(),
  classGroupName: z.string(),
  teacherName: z.string(),
  academicPeriodName: z.string(),
  planName: z.string(),
  planPriceId: z.string().uuid(),
  amountCents: z.number().int(),
  currency: z.literal("PEN"),
  paymentId: z.string().uuid().nullable(),
  paymentStatus: z.enum(["pending", "under_review", "approved", "rejected"]),
  paymentMethod: z.enum(["yape", "plin", "bcp", "interbank", "other"]),
  paymentMethodDetail: z.string().nullable(),
  operationNumber: z.string().nullable(),
  paidAt: z.string().nullable(),
});

const GetStudentResponseSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  nationalIdType: z.enum(["DNI", "CE", "passport"]),
  nationalId: z.string(),
  email: z.string(),
  // When the provider reported a hard bounce to `email` (OOC-91): the address
  // is dead, and what has to change is the file. Null while nothing bounced.
  emailInvalidAt: z.string().nullable(),
  phone: z.string(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  country: z.string(),
  region: z.string().nullable(),
  city: z.string(),
  createdAt: z.string(),
  isMinor: z.boolean(),
  status: z.enum(["active", "former", "under_review", "no_enrollment"]),
  activeCourses: z.number().int(),
  totalEnrollments: z.number().int(),
  lastActivityAt: z.string(),
  guardian: GuardianResponseSchema.nullable(),
  portalAccess: z.enum(["none", "pending_activation", "active"]),
  // Every enrollment the person ever opened, newest first — including seats
  // still waiting on money and ones handed back (OOC-73). The ledger lists
  // confirmed seats only; this is the person's history.
  enrollments: z.array(EnrollmentHistoryItemSchema),
  // The activity timeline (GET /students/:id/activity) and the student's
  // documents (GET /attachments, OOC-143/OOC-148) are their own routes. The
  // two always-empty lists this read used to send for issued documents and
  // paid requests left with the screen blocks that rendered them (OOC-148).
});

// management + enrollment supervision only — same audience as the rest of the student
// directory (CLAUDE.md §1). A teacher never reaches this route: the panel
// narrows them to their own class groups before a student id is ever in
// reach, and the role gate here is the backstop if they arrive by URL
// anyway.
export const getStudentRoute = RouteBuilder.get("/students/:studentId")
  .docs({
    tags: ["Students"],
    summary: "Get a student's file",
    description: "Backs the student detail screen — identity, contact, guardian and enrollment history.",
  })
  .roles(...STUDENT_FILE_ROLES)
  .params(GetStudentParamsSchema)
  .response(200, GetStudentResponseSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const [student, enrollments] = await Promise.all([
      container.queries.getStudent.run(request.params.studentId),
      container.queries.studentEnrollmentHistory.run(request.params.studentId),
    ]);

    if (!student) {
      throw new NotFoundError({
        reason: "student.not_found",
        message: `No student with id ${request.params.studentId}`,
        path: request.url,
      });
    }

    const portalAccess = await container.repositories.portalAccess.accessState(student.id);

    reply.status(200).send({
      ...student,
      portalAccess,
      // A calendar date, stored as UTC midnight: sent as `YYYY-MM-DD` so the
      // file prints it as written — read as an instant in America/Lima it
      // lands on the day before (OOC-109).
      birthDate: student.birthDate.toISOString().slice(0, 10),
      emailInvalidAt: student.emailInvalidAt?.toISOString() ?? null,
      createdAt: student.createdAt.toISOString(),
      lastActivityAt: student.lastActivityAt.toISOString(),
      guardian: student.guardian
        ? {
            ...student.guardian,
            consent: student.guardian.consent
              ? { ...student.guardian.consent, acceptedAt: student.guardian.consent.acceptedAt.toISOString() }
              : null,
          }
        : null,
      enrollments: enrollments.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        paidAt: item.paidAt?.toISOString() ?? null,
      })),
    });
  });
