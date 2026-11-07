import type { Role } from "../identity/Role.js";

/*
 * A file someone sent to the platform (OOC-143) — never a document the
 * institution issues: it carries no verification code. One bucket, one key per
 * file, and the key is the file's id (`documents/<id>`); the name the person
 * gave it lives only in the row.
 */

/** Whose file it is. A student today; a teacher, an enrollment or a payment
 * later — adding one here is the whole change on the domain side. */
export const ATTACHMENT_OWNER_TYPES = ["student"] as const;
export type AttachmentOwnerType = (typeof ATTACHMENT_OWNER_TYPES)[number];

export interface AttachmentOwner {
  type: AttachmentOwnerType;
  id: string;
}

/** What the file is, as the person who sent it said. */
export const ATTACHMENT_CATEGORIES = ["national_id", "guardian_consent", "receipt", "other"] as const;
export type AttachmentCategory = (typeof ATTACHMENT_CATEGORIES)[number];

/** What a file may be, checked against the file's own bytes at confirm —
 * never only against what the browser declared. */
export const ATTACHMENT_CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif"] as const;
export type AttachmentContentType = (typeof ATTACHMENT_CONTENT_TYPES)[number];

export function isAttachmentContentType(value: string | null | undefined): value is AttachmentContentType {
  return (ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(value ?? "");
}

/** Where it was sent from: the student's portal or the panel. */
export type AttachmentSource = "portal" | "backoffice";

/** `pending` until the confirm step reads what landed; `rejected` when the
 * bytes failed the check or the upload was never confirmed; `removed` when a
 * person took it off the list (soft delete — the row and the object stay). */
export type AttachmentStatus = "pending" | "uploaded" | "rejected" | "removed";

export type AttachmentRejectionReason = "unsupported_type" | "too_large" | "not_confirmed";

/** How long an upload may stay unconfirmed before the sweep clears it. The
 * signed POST dies in five minutes, so an hour is long past any real upload. */
export const ATTACHMENT_PENDING_TTL_MS = 60 * 60 * 1000;

/** The signed download link's life (CLAUDE.md §8: five minutes). */
export const ATTACHMENT_DOWNLOAD_URL_SECONDS = 5 * 60;

/** The row as the usecases need it. */
export interface StoredAttachment {
  id: string;
  owner: AttachmentOwner;
  category: AttachmentCategory;
  objectKey: string;
  originalName: string;
  mimeType: string;
  uploadedBy: string;
  status: AttachmentStatus;
}

/** One line of an owner's list. */
export interface AttachmentListItem {
  id: string;
  category: AttachmentCategory;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  source: AttachmentSource;
  uploadedAt: Date;
  /** Null when the account behind the upload no longer resolves to a name. */
  uploadedByName: string | null;
}

/** Who is acting: the session's account and cargo, never a value from the client. */
export interface AttachmentActor {
  userId: string;
  role: Role;
}

/** Which staff cargos reach each kind of owner's files. The API owns the
 * answer (it is the student file's audience for students). */
export type AttachmentStaffPolicy = Readonly<Record<AttachmentOwnerType, readonly Role[]>>;

const MAX_NAME_LENGTH = 200;

/**
 * The name to keep for a file: the last path segment, without control
 * characters, trimmed and capped. Only ever shown back and used in the
 * download's `Content-Disposition` — the bucket key never comes from it.
 */
export function normalizeAttachmentName(raw: string): string {
  const lastSegment = raw.split(/[\\/]/).pop() ?? "";
  const clean = lastSegment.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return clean.slice(0, MAX_NAME_LENGTH) || "file";
}
