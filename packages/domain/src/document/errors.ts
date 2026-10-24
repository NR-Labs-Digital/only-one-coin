import { NotFoundError } from "../shared/base/errors/NotFoundError.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";

export class DocumentKindNotFoundError extends NotFoundError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "document_template.kind_not_found", message: "No document kind with that key.", ...params });
  }
}

/** Publishing needs a draft: there is nothing written yet. */
export class DocumentTemplateDraftMissingError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "document_template.draft_missing", message: "There is no draft to publish.", ...params });
  }
}

/**
 * The draft does not pass the check. The issues themselves come back with
 * every draft save, so the editor already has them to mark.
 */
export class DocumentTemplateHasIssuesError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "document_template.has_issues",
      message: "The template does not pass the check and cannot be used.",
      ...params,
    });
  }
}
