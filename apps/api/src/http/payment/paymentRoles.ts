import type { Role } from "@ooc/domain";

/** Who reads Payments — matches `canViewPayments` (apps/app/src/lib/backoffice/permissions.ts). */
export const PAYMENT_READ_ROLES = ["master", "admin", "analyst", "billing", "support"] as const satisfies readonly Role[];

/** Who opens the receipt image — personal data, so the reviewers and the analyst who observes them. */
export const PAYMENT_RECEIPT_ROLES = ["master", "admin", "analyst", "billing"] as const satisfies readonly Role[];

/** Who settles money — `canReviewPayments`. Never enrollment_supervisor (CLAUDE.md §1, lock (d)). */
export const PAYMENT_SETTLE_ROLES = ["master", "admin", "billing"] as const satisfies readonly Role[];

/**
 * Who gets the student's mobile number in the review queue — the WhatsApp
 * shortcut (OOC-146; proposal, to be confirmed with the owner). Whoever settles
 * the payment and `support`, who answers students; `analyst` observes and does
 * not contact anyone, so the number stays off their screen.
 */
export const PAYMENT_CONTACT_ROLES = [...PAYMENT_SETTLE_ROLES, "support"] as const satisfies readonly Role[];
