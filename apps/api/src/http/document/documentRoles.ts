import type { Role } from "@ooc/domain";

/**
 * Who edits, previews and publishes document templates (OOC-123) — management
 * only (decision of 23/10/2026): a contract or a certificate is a legal
 * document, and its text is the institution's word.
 */
export const DOCUMENT_TEMPLATE_ROLES = ["master", "admin"] as const satisfies readonly Role[];
