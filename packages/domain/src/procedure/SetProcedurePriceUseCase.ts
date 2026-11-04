import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { InvalidProcedurePriceError } from "./errors.js";
import { PROCEDURE_PRICE_BOUNDS, type ProcedureKind, type ProcedurePrice } from "./Procedure.js";
import type { IProcedureRepository } from "./ProcedureRepository.js";

export interface SetProcedurePriceInput {
  actorId: string;
  kind: ProcedureKind;
  amountCents: number;
}

/**
 * A new price for a procedure: a new row, in force from now. Requests already
 * opened keep the amount they froze. Setting the price it already has leaves no
 * version and no trail, like an unchanged setting.
 */
export class SetProcedurePriceUseCase extends BaseUseCase<SetProcedurePriceInput, ProcedurePrice> {
  constructor(private readonly procedures: IProcedureRepository) {
    super();
  }

  async run(input: SetProcedurePriceInput): Promise<ProcedurePrice> {
    const { amountCents } = input;
    if (!Number.isInteger(amountCents) || amountCents < PROCEDURE_PRICE_BOUNDS.min || amountCents > PROCEDURE_PRICE_BOUNDS.max) {
      throw new InvalidProcedurePriceError();
    }

    const current = (await this.procedures.currentPrices()).find((price) => price.kind === input.kind);
    if (current?.amountCents === amountCents) return current;

    return this.procedures.addPrice({
      kind: input.kind,
      amountCents,
      actorId: input.actorId,
      audit: {
        actorId: input.actorId,
        action: "procedure_price.created",
        metadata: { kind: input.kind, from: current?.amountCents ?? null, to: amountCents },
        at: new Date(),
      },
    });
  }
}
