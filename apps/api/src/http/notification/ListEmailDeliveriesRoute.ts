import { z } from "zod";
import { DELIVERY_FAILURE_REASONS, STUDENT_DELIVERY_TEMPLATES, type StudentDeliveryTemplate } from "@ooc/domain";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { EMAIL_DELIVERY_READ_ROLES } from "./emailDeliveryRoles.js";

const TemplateSchema = z.enum(STUDENT_DELIVERY_TEMPLATES as [StudentDeliveryTemplate, ...StudentDeliveryTemplate[]]);

const EmailDeliveryIssueSchema = z.object({
  id: z.string().uuid(),
  template: TemplateSchema,
  studentId: z.string().uuid().nullable(),
  studentName: z.string().nullable(),
  recipientKind: z.enum(["student", "guardian"]),
  address: z.string(),
  reason: z.enum(DELIVERY_FAILURE_REASONS),
  at: z.string(),
  attempts: z.number().int(),
  resendable: z.boolean(),
});

// The undelivered e-mails screen (OOC-90). Only failed sends: a bounce, a
// full mailbox or an unknown address exist once the provider's webhook
// reports them, and nothing does yet.
export const listEmailDeliveriesRoute = RouteBuilder.get("/emails/deliveries")
  .docs({
    tags: ["E-mails"],
    summary: "The e-mails about a student that failed and were not resent",
    description: "Newest first, at most 200 rows; `total` counts them all. Each row names the student file its subject leads to.",
  })
  .roles(...EMAIL_DELIVERY_READ_ROLES)
  .query(z.object({ template: TemplateSchema.optional() }))
  .response(200, z.object({ items: z.array(EmailDeliveryIssueSchema), total: z.number().int() }))
  .response(400, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const page = await container.queries.emailDeliveries.list({ template: request.query.template });
    reply.status(200).send({
      total: page.total,
      items: page.items.map((item) => ({ ...item, at: item.at.toISOString() })),
    });
  });
