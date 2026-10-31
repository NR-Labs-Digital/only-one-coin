import { describe, expect, it } from 'vitest'
import {
  EMAIL_AUDIENCES,
  EMAIL_CATALOG,
  EMAIL_CATALOG_KEYS,
  EMAIL_STAGES,
} from '@ooc/domain/email-catalog'
import en from '@/messages/backoffice/en.json'
import es from '@/messages/backoffice/es-PE.json'
import pt from '@/messages/backoffice/pt-BR.json'
import { buildEmailJourney, catalogJourneyFlows } from './email-journey'

/**
 * OOC-87: one catalog of e-mails for the app and the API. Every key it can hand
 * the screens has a name and a trigger in each locale (CLAUDE.md §4 — never a
 * template code on screen), and the journey draws exactly the catalog. The
 * preview's words are not here: they are the repository template, rendered by
 * the API (OOC-88).
 */

describe('e-mail catalog labels', () => {
  it.each([
    ['es-PE', es],
    ['pt-BR', pt],
    ['en', en],
  ])('%s names every template, trigger, condition, stage and audience', (_locale, messages) => {
    const bo = messages.bo as unknown as {
      email_template: Record<string, string>
      email_trigger: Record<string, string>
      email_condition: Record<string, string>
      email_stage: Record<string, string>
      email_audience: Record<string, string>
    }
    expect(Object.keys(bo.email_template).sort()).toEqual([...EMAIL_CATALOG_KEYS].sort())
    expect(Object.keys(bo.email_trigger).sort()).toEqual([...EMAIL_CATALOG_KEYS].sort())
    /* The condition rides the branch on the journey, so only a conditional
       flow that sits on the journey needs one. */
    expect(
      EMAIL_CATALOG_KEYS.filter(
        (key) => EMAIL_CATALOG[key].conditional && EMAIL_CATALOG[key].stage !== null && !bo.email_condition[key],
      ),
    ).toEqual([])
    expect(Object.keys(bo.email_stage).sort()).toEqual([...EMAIL_STAGES].sort())
    expect(Object.keys(bo.email_audience).sort()).toEqual([...EMAIL_AUDIENCES].sort())
  })
})

describe('e-mail journey over the catalog', () => {
  it('reads every catalog entry once, in catalog order, with what the catalog says', () => {
    const flows = catalogJourneyFlows()
    expect(flows.map((flow) => flow.template)).toEqual(EMAIL_CATALOG_KEYS)
    for (const flow of flows) {
      expect(flow).toMatchObject(EMAIL_CATALOG[flow.template])
    }
  })

  it('puts every flow with a stage on the journey, and only those', () => {
    const onJourney = buildEmailJourney(catalogJourneyFlows()).flatMap((stage) => stage.flows.map((flow) => flow.template))
    expect(onJourney.sort()).toEqual(EMAIL_CATALOG_KEYS.filter((key) => EMAIL_CATALOG[key].stage !== null).sort())
  })
})
