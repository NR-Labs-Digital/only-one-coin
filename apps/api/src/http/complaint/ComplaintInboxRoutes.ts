import { COMPLAINT_STATUSES, MAX_COMPLAINT_ANSWER_LENGTH, type ComplaintView } from "@ooc/domain";
import { z } from "zod";
import { container } from "@/container.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";

/**
 * The team's side of the complaints book (OOC-58): the inbox, one sheet,
 * taking it and answering it, and the sheets on a student's file. Reading is
 * `complaints.view`; taking and answering, `complaints.answer`. The sheet's
 * status, deadline and link to a student file are read, never stored.
 */

const NationalIdTypeSchema = z.enum(["DNI", "CE", "passport"]);

const StepSchema = z.object({
  /** ISO 8601, UTC. */
  at: z.string().datetime(),
  byName: z.string().nullable(),
});

const StudentLinkSchema = z.object({ studentId: z.string().uuid(), fullName: z.string() });

const ComplaintRowSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  kind: z.enum(["claim", "grievance"]),
  goodType: z.enum(["product", "service"]),
  /** ISO 8601, UTC. */
  filedAt: z.string().datetime(),
  consumerName: z.string(),
  consumerNationalIdType: NationalIdTypeSchema,
  consumerNationalId: z.string(),
  consumerIsMinor: z.boolean(),
  status: z.enum(COMPLAINT_STATUSES),
  /** Calendar day in Lima, `YYYY-MM-DD` — the last day to answer. */
  dueOn: z.string(),
  /** ISO 8601, UTC — the end of `dueOn` in Lima. */
  deadlineAt: z.string().datetime(),
  overdue: z.boolean(),
  answeredLate: z.boolean(),
  businessDaysLeft: z.number().int(),
  taken: StepSchema.nullable(),
  answered: StepSchema.nullable(),
  student: StudentLinkSchema.nullable(),
});

const ComplaintDetailSchema = ComplaintRowSchema.extend({
  supplier: z.object({ legalName: z.string(), ruc: z.string(), address: z.string() }),
  consumer: z.object({
    firstName: z.string(),
    lastName: z.string(),
    secondLastName: z.string().nullable(),
    nationalIdType: NationalIdTypeSchema,
    nationalId: z.string(),
    phone: z.string(),
    email: z.string(),
    department: z.string(),
    province: z.string(),
    district: z.string(),
    address: z.string(),
    addressReference: z.string().nullable(),
    isMinor: z.boolean(),
  }),
  guardian: z
    .object({ firstName: z.string(), lastName: z.string(), nationalIdType: NationalIdTypeSchema, nationalId: z.string() })
    .nullable(),
  amountCents: z.number().int().nullable(),
  purchasedOn: z.string().nullable(),
  description: z.string(),
  detail: z.string(),
  request: z.string(),
  locale: z.enum(["es-PE", "pt-BR", "en"]),
  /** The answer the consumer got by e-mail; null until answered. */
  answer: z.string().nullable(),
});

const fullName = (view: ComplaintView) =>
  [view.consumer.firstName, view.consumer.lastName, view.consumer.secondLastName].filter(Boolean).join(" ");

const step = (value: { at: Date; actorName: string | null } | null) =>
  value ? { at: value.at.toISOString(), byName: value.actorName } : null;

function serializeRow(view: ComplaintView): z.infer<typeof ComplaintRowSchema> {
  return {
    id: view.id,
    code: view.code,
    kind: view.kind,
    goodType: view.goodType,
    filedAt: view.filedAt.toISOString(),
    consumerName: fullName(view),
    consumerNationalIdType: view.consumer.nationalIdType,
    consumerNationalId: view.consumer.nationalId,
    consumerIsMinor: view.consumer.isMinor,
    status: view.status,
    dueOn: view.dueOn,
    deadlineAt: view.deadlineAt.toISOString(),
    overdue: view.overdue,
    answeredLate: view.answeredLate,
    businessDaysLeft: view.businessDaysLeft,
    taken: step(view.taken),
    answered: step(view.answered),
    student: view.student,
  };
}

function serializeDetail(view: ComplaintView): z.infer<typeof ComplaintDetailSchema> {
  return {
    ...serializeRow(view),
    supplier: view.supplier,
    consumer: view.consumer,
    guardian: view.guardian,
    amountCents: view.amountCents,
    purchasedOn: view.purchasedOn,
    description: view.description,
    detail: view.detail,
    request: view.request,
    locale: view.locale,
    answer: view.answered?.answer ?? null,
  };
}

const CountsSchema = z.object({
  received: z.number().int(),
  in_progress: z.number().int(),
  answered: z.number().int(),
  overdue: z.number().int(),
});

export const listComplaintsRoute = RouteBuilder.get("/complaints")
  .docs({
    tags: ["Complaints"],
    summary: "The complaints book, newest sheet first",
    description:
      "`counts` are per status (and overdue) under the search, never under the status filter. The deadline counts `responseBusinessDays` business days, Monday to Friday in Lima.",
  })
  .can("complaints.view")
  .query(
    z.object({
      status: z.enum(COMPLAINT_STATUSES).optional(),
      overdue: z.enum(["true", "false"]).optional(),
      q: z.string().trim().max(100).optional(),
    }),
  )
  .response(
    200,
    z.object({ items: z.array(ComplaintRowSchema), counts: CountsSchema, responseBusinessDays: z.number().int() }),
  )
  .handler(async (request, reply) => {
    const result = await container.useCases.complaint.list.run({
      status: request.query.status ?? null,
      overdue: request.query.overdue === "true",
      search: request.query.q ? request.query.q : null,
    });
    reply.status(200).send({
      items: result.items.map(serializeRow),
      counts: result.counts,
      responseBusinessDays: result.responseBusinessDays,
    });
  });

export const complaintInboxSummaryRoute = RouteBuilder.get("/complaints/summary")
  .docs({
    tags: ["Complaints"],
    summary: "The menu's badge: sheets nobody took yet, and the overdue ones",
  })
  .can("complaints.view")
  .response(200, z.object({ received: z.number().int(), overdue: z.number().int() }))
  .handler(async (_request, reply) => {
    reply.status(200).send(await container.useCases.complaint.summary.run());
  });

const ComplaintParamsSchema = z.object({ complaintId: z.string().uuid() });

export const getComplaintRoute = RouteBuilder.get("/complaints/:complaintId")
  .docs({ tags: ["Complaints"], summary: "One sheet of the complaints book, with its steps and answer" })
  .can("complaints.view")
  .params(ComplaintParamsSchema)
  .response(200, ComplaintDetailSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const view = await container.useCases.complaint.get.run({ complaintId: request.params.complaintId });
    reply.status(200).send(serializeDetail(view));
  });

export const takeComplaintRoute = RouteBuilder.post("/complaints/:complaintId/take")
  .docs({
    tags: ["Complaints"],
    summary: "Take a sheet: the inbox stops counting it as unread",
    description: "Once per sheet. Taken already is 409 `complaint.already_taken`; answered, 409 `complaint.already_answered`.",
  })
  .can("complaints.answer")
  .params(ComplaintParamsSchema)
  .response(204, z.void())
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .handler(async (request, reply) => {
    await container.useCases.complaint.take.run({
      complaintId: request.params.complaintId,
      actorId: request.currentUser!.id,
    });
    reply.status(204).send();
  });

export const answerComplaintRoute = RouteBuilder.post("/complaints/:complaintId/answer")
  .docs({
    tags: ["Complaints"],
    summary: "Answer a sheet: the answer is written once and e-mailed to the consumer",
    description:
      "1 to 5000 characters after trimming (422 `complaint.answer_required`). A second answer is 409 `complaint.already_answered`.",
  })
  .can("complaints.answer")
  .params(ComplaintParamsSchema)
  .body(z.object({ answer: z.string().max(MAX_COMPLAINT_ANSWER_LENGTH * 2) }))
  .response(204, z.void())
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    await container.useCases.complaint.answer.run({
      complaintId: request.params.complaintId,
      actorId: request.currentUser!.id,
      answer: request.body.answer,
    });
    reply.status(204).send();
  });

export const listStudentComplaintsRoute = RouteBuilder.get("/students/:studentId/complaints")
  .docs({
    tags: ["Complaints"],
    summary: "The sheets whose consumer document is this student file's",
    description: "Compared normalized, against the newest live file with that document.",
  })
  .can("complaints.view")
  .params(z.object({ studentId: z.string().uuid() }))
  .response(200, z.object({ items: z.array(ComplaintRowSchema) }))
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const items = await container.useCases.complaint.listForStudent.run({ studentId: request.params.studentId });
    reply.status(200).send({ items: items.map(serializeRow) });
  });
