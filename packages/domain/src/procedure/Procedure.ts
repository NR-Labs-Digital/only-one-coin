import { z } from "zod";

/**
 * Paid procedures (docs/REGRAS-NEGOCIO.md §5) — "solicitação com pagamento
 * associado", CLAUDE.md §1. The constancia is the first wave because it is the
 * one whose rule is closed; a new kind is an entry here, a value in the CHECKs
 * of `procedure_prices` and `procedure_requests`, and its own eligibility rule.
 */
export const PROCEDURE_KINDS = ["enrollment_certificate"] as const;
export const ProcedureKindSchema = z.enum(PROCEDURE_KINDS);
export type ProcedureKind = z.infer<typeof ProcedureKindSchema>;

/**
 * `requested → paid → fulfilled`, or `requested → rejected`. Approving the
 * payment makes it `paid`; `fulfilled` belongs to the procedure's own flow
 * (OOC-33 for the constancia). A rejected request is final: trying again is a
 * new request, with the price of that day.
 */
export const PROCEDURE_REQUEST_STATUSES = ["requested", "paid", "fulfilled", "rejected"] as const;
export type ProcedureRequestStatus = (typeof PROCEDURE_REQUEST_STATUSES)[number];

/** The same limits the constancia's fee had in the settings (OOC-41): a
 * procedure is paid, and a typo should not make it cost a fortune. */
export const PROCEDURE_PRICE_BOUNDS = { min: 100, max: 100_000 } as const;

export interface ProcedurePrice {
  id: string;
  kind: ProcedureKind;
  amountCents: number;
  validFrom: Date;
}

/** The read shape every step after opening works from. */
export interface ProcedureRequestRef {
  id: string;
  kind: ProcedureKind;
  status: ProcedureRequestStatus;
  studentId: string;
  enrollmentId: string;
  /** Frozen when the request was opened — never the price of today. */
  amountCents: number;
  paymentId: string | null;
}

/** Only a request still waiting for its money takes a receipt. */
export function acceptsPayment(request: Pick<ProcedureRequestRef, "status" | "paymentId">): boolean {
  return request.status === "requested" && request.paymentId === null;
}
