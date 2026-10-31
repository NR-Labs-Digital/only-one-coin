import { EMAIL_CATALOG, EMAIL_CATALOG_KEYS, EMAIL_STAGES } from '@ooc/domain/email-catalog'
import type { EmailFlow, EmailStage } from './types'

/** What the journey draws of a flow: the catalog's facts, no figures. */
export type EmailJourneyFlow = Pick<EmailFlow, 'template' | 'stage' | 'conditional' | 'emitted'>

/**
 * The catalog itself, as the journey reads it. The journey has no numbers on
 * it, so it reads the one catalog (OOC-87) straight from `@ooc/domain` rather
 * than asking the API for counts it would throw away.
 */
export function catalogJourneyFlows(): EmailJourneyFlow[] {
  return EMAIL_CATALOG_KEYS.map((template) => ({ template, ...EMAIL_CATALOG[template] }))
}

export interface EmailJourneyStage<T extends EmailJourneyFlow = EmailJourneyFlow> {
  stage: EmailStage
  /** In catalog order — which is the order they fire inside the stage. */
  flows: T[]
}

/**
 * The catalog, cut into the moments, in the order the student lives them. The
 * order is the catalog's own stage list rather than read off the flows, so a
 * template added in the middle of the list still lands in the stage it belongs
 * to. A stage with nothing in it is kept: a silent stretch of the journey is
 * worth seeing, not hiding.
 */
export function buildEmailJourney<T extends EmailJourneyFlow>(flows: T[]): EmailJourneyStage<T>[] {
  return EMAIL_STAGES.map((stage) => ({
    stage,
    /* Account security and the staff's e-mails carry no stage on purpose
       (`EmailFlow.stage`): none is a step of the student's journey. */
    flows: flows.filter((flow) => flow.stage === stage),
  }))
}
