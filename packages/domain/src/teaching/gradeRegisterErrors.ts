import type { HttpError } from "../shared/base/errors/HttpError.js";
import { ConflictError } from "../shared/base/errors/ConflictError.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";
import type { RegisterTransitionOutcome } from "./gradeRegister.js";

/** The refusal of a register step that did not happen (OOC-180). */
export function registerTransitionError(outcome: Exclude<RegisterTransitionOutcome, { kind: "done" }>): HttpError {
  switch (outcome.kind) {
    case "empty":
      return new UnableToProcessEntryError({
        reason: "teaching.grade_register_empty",
        message: "Nothing of this round was posted yet.",
      });
    case "incomplete":
      return new UnableToProcessEntryError({
        reason: "teaching.grade_register_incomplete",
        message: "Some students of this round still have no grade.",
      });
    case "wrong_status":
      return new UnableToProcessEntryError({
        reason: "teaching.grade_register_wrong_status",
        message: "The register is not in a state this step starts from.",
      });
    case "concurrent":
      return new ConflictError({
        reason: "teaching.grade_register_concurrent",
        message: "Somebody moved this register at the same moment. Reload and try again.",
      });
  }
}
