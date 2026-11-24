import type { ComplaintSupplier, FiledComplaint } from "../complaint/Complaint.js";
import type { ComplaintForm } from "../student/fields.js";
import type { EmailNotification, Locale } from "./EmailNotification.js";

export interface ComplaintEmailFacts extends FiledComplaint {
  form: ComplaintForm;
  supplier: ComplaintSupplier;
}

const fullName = (person: { firstName: string; lastName: string; secondLastName?: string | null }) =>
  [person.firstName, person.lastName, person.secondLastName].filter(Boolean).join(" ");

/**
 * The consumer's copy of the sheet (OOC-63): the regulation has the consumer
 * receive it. One e-mail, to the address on the sheet — the guardian of a
 * minor is named on it but gets no copy of their own. Keyed by the sheet.
 */
export function complaintFiledEmails(facts: ComplaintEmailFacts, locale: Locale): EmailNotification[] {
  const { form } = facts;
  const consumer = form.consumer;
  const address = [consumer.address, consumer.district, consumer.province, consumer.department].join(", ");
  return [
    {
      templateKey: "complaint_filed",
      to: consumer.email,
      locale,
      vars: {
        recipientName: consumer.firstName,
        code: facts.code,
        filedAt: facts.filedAt.toISOString(),
        kind: form.kind,
        legalName: facts.supplier.legalName,
        ruc: facts.supplier.ruc,
        supplierAddress: facts.supplier.address,
        consumerName: fullName(consumer),
        nationalIdType: consumer.nationalIdType,
        nationalId: consumer.nationalId,
        address: consumer.addressReference ? `${address} (${consumer.addressReference})` : address,
        phone: consumer.phone,
        email: consumer.email,
        guardianName: form.guardian ? fullName(form.guardian) : null,
        guardianNationalIdType: form.guardian?.nationalIdType ?? null,
        guardianNationalId: form.guardian?.nationalId ?? null,
        goodType: form.goodType,
        amountCents: form.amountCents,
        purchasedOn: form.purchasedOn,
        description: form.description,
        detail: form.detail,
        request: form.request,
      },
      dedupeKey: `complaint_filed:${facts.id}`,
    },
  ];
}
