import { NotFoundError } from "../shared/base/errors/NotFoundError.js";

export class CatalogEntryNotFoundError extends NotFoundError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "catalog.entry_not_found",
      message: "No catalog entry of that kind with that id.",
      ...params,
    });
  }
}
