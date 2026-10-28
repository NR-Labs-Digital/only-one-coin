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
import { buildEmailJourney, isEmailFlowPaused } from './email-journey'
import { getEmailMetrics, listEmailFlows } from './mock-data'

/**
 * OOC-87: one catalog of e-mails for the app and the API. Every key it can hand
 * the screens has a name, a trigger and a preview in each locale (CLAUDE.md §4 —
 * never a template code on screen), and the screens list exactly the catalog.
 */

describe('e-mail catalog labels', () => {
  it.each([
    ['es-PE', es],
    ['pt-BR', pt],
    ['en', en],
  ])('%s names every template, trigger, preview, condition, stage and audience', (_locale, messages) => {
    const bo = messages.bo as unknown as {
      email_template: Record<string, string>
      email_trigger: Record<string, string>
      email_preview: Record<string, { subject?: string; p1?: string; p2?: string }>
      email_condition: Record<string, string>
      email_stage: Record<string, string>
      email_audience: Record<string, string>
    }
    expect(Object.keys(bo.email_template).sort()).toEqual([...EMAIL_CATALOG_KEYS].sort())
    expect(Object.keys(bo.email_trigger).sort()).toEqual([...EMAIL_CATALOG_KEYS].sort())
    expect(Object.keys(bo.email_preview).sort()).toEqual([...EMAIL_CATALOG_KEYS].sort())
    expect(
      EMAIL_CATALOG_KEYS.filter((key) => {
        const preview = bo.email_preview[key]
        return !preview?.subject || !preview.p1 || !preview.p2
      }),
    ).toEqual([])
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

describe('e-mail screens over the catalog', () => {
  it('lists every catalog entry once, in catalog order, with what the catalog says', () => {
    const flows = listEmailFlows()
    expect(flows.map((flow) => flow.template)).toEqual(EMAIL_CATALOG_KEYS)
    for (const flow of flows) {
      expect(flow).toMatchObject(EMAIL_CATALOG[flow.template])
    }
  })

  it('puts every flow with a stage on the journey, and only those', () => {
    const onJourney = buildEmailJourney(listEmailFlows()).flatMap((stage) => stage.flows.map((flow) => flow.template))
    expect(onJourney.sort()).toEqual(EMAIL_CATALOG_KEYS.filter((key) => EMAIL_CATALOG[key].stage !== null).sort())
  })

  it('never counts a template nothing sends yet as paused', () => {
    const notEmitted = listEmailFlows().filter((flow) => !flow.emitted)
    expect(notEmitted.length).toBeGreaterThan(0)
    expect(notEmitted.filter(isEmailFlowPaused)).toEqual([])
    expect(getEmailMetrics().paused).toBe(listEmailFlows().filter(isEmailFlowPaused).length)
  })
})
