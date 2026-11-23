import { ConflictError } from "../shared/base/errors/ConflictError.js";
import { NotFoundError } from "../shared/base/errors/NotFoundError.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";

/** Somebody else's document, or none: the same answer (CLAUDE.md §8). */
export class IssuedDocumentNotFoundError extends NotFoundError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "issued_document.not_found", message: "The issued document does not exist.", ...params });
  }
}

/** A certificate batch is confirmed only on the module group of the course's last module. */
export class CertificateRunNotLastModuleError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "certificate.not_last_module",
      message: "Certificates are issued on the module group of the course's last module.",
      ...params,
    });
  }
}

/** Nothing in the batch can be issued any more (somebody issued it, or a grade changed). */
export class CertificateNothingToIssueError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "certificate.nothing_to_issue", message: "None of the enrollments can get the certificate now.", ...params });
  }
}

/** Revoking without saying why (OOC-59): the reason is what the next person reads. */
export class IssuedDocumentRevocationReasonRequiredError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "issued_document.revocation_reason_required",
      message: "A revocation needs a reason of 1 to 500 characters.",
      ...params,
    });
  }
}

/** The document was already revoked, or replaced — a revocation happens once. */
export class IssuedDocumentAlreadyRevokedError extends ConflictError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "issued_document.already_revoked", message: "The issued document is no longer valid.", ...params });
  }
}
