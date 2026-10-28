import { EMAIL_STAGES } from '@ooc/domain/email-catalog'
import type { EmailFlow, EmailStage } from './types'

/**
 * Switched off: somebody is waiting for an e-mail that is never coming. A
 * template nothing sends yet is not paused — there is no switch to flip.
 */
export function isEmailFlowPaused(flow: EmailFlow): boolean {
  return flow.emitted && !flow.enabled
}

export interface EmailJourneyStage {
  stage: EmailStage
  /** In catalog order — which is the order they fire inside the stage. */
  flows: EmailFlow[]
}

/**
 * The catalog, cut into the moments, in the order the student lives them. The
 * order is the catalog's own stage list rather than read off the flows, so a
 * template added in the middle of the list still lands in the stage it belongs
 * to. A stage with nothing in it is kept: a silent stretch of the journey is
 * worth seeing, not hiding.
 */
export function buildEmailJourney(flows: EmailFlow[]): EmailJourneyStage[] {
  return EMAIL_STAGES.map((stage) => ({
    stage,
    /* Account security and the staff's e-mails carry no stage on purpose
       (`EmailFlow.stage`): none is a step of the student's journey. */
    flows: flows.filter((flow) => flow.stage === stage),
  }))
}
