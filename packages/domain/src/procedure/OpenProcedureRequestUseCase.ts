import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { ProcedureAlreadyOpenError, ProcedureEnrollmentNotEligibleError, ProcedurePriceNotSetError } from "./errors.js";
import { acceptsPayment, type ProcedureKind, type ProcedureRequestRef } from "./Procedure.js";
import type { IProcedureRepository } from "./ProcedureRepository.js";

export interface OpenProcedureRequestInput {
  /** From the session, never from the client (CLAUDE.md §8). */
  userId: string;
  kind: ProcedureKind;
  enrollmentId: string;
}

/**
 * The student asks for a procedure on one of their enrollments. The price is
 * frozen here. Asking again while the first request still waits for a receipt
 * returns that request — closing the form and coming back is ordinary; once it
 * carries a payment, or is paid, the same procedure cannot be bought twice.
 */
export class OpenProcedureRequestUseCase extends BaseUseCase<OpenProcedureRequestInput, ProcedureRequestRef> {
  constructor(private readonly procedures: IProcedureRepository) {
    super();
  }

  async run(input: OpenProcedureRequestInput): Promise<ProcedureRequestRef> {
    const eligible = await this.procedures.findEligibleEnrollment({ userId: input.userId, enrollmentId: input.enrollmentId });
    if (!eligible) throw new ProcedureEnrollmentNotEligibleError();

    const request = await this.procedures.open({
      kind: input.kind,
      studentId: eligible.studentId,
      enrollmentId: input.enrollmentId,
      actorId: input.userId,
    });
    if (!request) throw new ProcedurePriceNotSetError();
    if (!acceptsPayment(request)) throw new ProcedureAlreadyOpenError();
    return request;
  }
}
