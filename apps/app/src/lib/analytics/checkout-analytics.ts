import posthog from 'posthog-js/dist/module.slim.no-external'
import {
  ANALYTICS_HANDOFF_PARAM,
  FUNNEL_EVENTS,
  adConsentCookie,
  isAnalyticsHandoffId,
  readAdConsent,
  type AdConsent,
} from '@ooc/domain/analytics'
import { env } from '@/env'
import type { StepId } from '@/lib/enrollment/types'
import { loadPixels, trackPixelEvent, validPixelId } from './pixels'

/**
 * Measurement on the public checkout (OOC-47) — and only there: portal,
 * backoffice and teacher screens never import this, and their CSP has none
 * of the hosts (`middleware.ts`).
 *
 * - PostHog for everybody, with no cookie (`@ooc/domain/analytics` says why).
 *   The landing hands over its anonymous id in the fragment (`#ph_id=`), so
 *   a visit that started on a course page is the same funnel here. Events go
 *   through our own domain (`/ooc-ev`, a rewrite in `next.config.ts`).
 * - Meta and TikTok only with the banner accepted.
 *
 * What is sent is the step and the shape of the purchase — how many courses,
 * the expected total — never a field the reader typed. PostHog never sees
 * the form: autocapture is off and every event is named here.
 */

const POSTHOG_PROXY = '/ooc-ev'
const POSTHOG_UI = 'https://eu.posthog.com'

export const pixelIds = {
  meta: validPixelId(env.NEXT_PUBLIC_META_PIXEL_ID),
  tiktok: validPixelId(env.NEXT_PUBLIC_TIKTOK_PIXEL_ID),
}
export const hasPixels = Boolean(pixelIds.meta || pixelIds.tiktok)

let started = false
let posthogReady = false

/** The id the landing put in the fragment, removed from the address bar
 * either way — it is a handoff, not part of the page's address. */
function takeHandoffId(): string | undefined {
  const fragment = new URLSearchParams(window.location.hash.slice(1))
  const id = fragment.get(ANALYTICS_HANDOFF_PARAM)
  if (id === null) return undefined
  fragment.delete(ANALYTICS_HANDOFF_PARAM)
  const rest = fragment.toString()
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}${rest ? `#${rest}` : ''}`,
  )
  return isAnalyticsHandoffId(id) ? id : undefined
}

/** Starts PostHog and, with the banner already accepted, the pixels. Once
 * per page load, whatever re-renders. Returns the stored banner answer. */
export function startCheckoutAnalytics(): AdConsent | null {
  const consent = readAdConsent(document.cookie)
  if (started) return consent
  started = true

  const handoffId = takeHandoffId()
  const key = env.NEXT_PUBLIC_POSTHOG_KEY?.trim()
  if (key) {
    posthog.init(key, {
      api_host: POSTHOG_PROXY,
      ui_host: POSTHOG_UI,
      persistence: 'sessionStorage',
      person_profiles: 'identified_only',
      // A new tab from the landing already has its id; a reload keeps the one
      // in sessionStorage.
      ...(handoffId ? { bootstrap: { distinctID: handoffId } } : {}),
      autocapture: false,
      capture_pageview: true,
      capture_pageleave: true,
      rageclick: false,
      capture_dead_clicks: false,
      capture_exceptions: false,
      capture_performance: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_product_tours: true,
      disable_conversations: true,
      disable_web_experiments: true,
      advanced_disable_flags: true,
      disable_external_dependency_loading: true,
      mask_personal_data_properties: true,
    })
    posthogReady = true
    posthog.capture(FUNNEL_EVENTS.checkoutStarted)
  }

  if (hasPixels && consent === 'granted') {
    loadPixels(pixelIds)
    trackPixelEvent('checkout_started')
  }
  return consent
}

/** Stores the banner answer; a yes loads the pixels right away. Withdrawing
 * a yes reloads the page — a loaded pixel cannot be unloaded. The draft is in
 * `sessionStorage`, so the reload loses nothing typed. */
export function answerAdConsent(value: AdConsent): void {
  const wasGranted = readAdConsent(document.cookie) === 'granted'
  document.cookie = adConsentCookie(value, {
    domain: env.NEXT_PUBLIC_CONSENT_COOKIE_DOMAIN,
    secure: window.location.protocol === 'https:',
  })
  if (value === 'granted' && !wasGranted) {
    loadPixels(pixelIds)
    trackPixelEvent('checkout_started')
  }
  if (value === 'denied' && wasGranted) window.location.reload()
}

// Each tracker starts the analytics itself: a child's effect (the wizard's
// first step) runs before the layout's, and must not be lost.

export function trackCheckoutStep(step: StepId): void {
  startCheckoutAnalytics()
  if (posthogReady) posthog.capture(FUNNEL_EVENTS.stepViewed, { step })
}

/** The conversion: the API accepted the receipt. The seat is still only
 * reserved — a person approves the payment later (`CLAUDE.md` §1) — but the
 * money has been paid by then, which is what the campaigns optimise for. */
export function trackCheckoutSubmitted(data: {
  courses: number
  totalCents: number
  source: string
  eventId: string
}): void {
  startCheckoutAnalytics()
  if (posthogReady) {
    posthog.capture(FUNNEL_EVENTS.submitted, {
      courses: data.courses,
      value: data.totalCents / 100,
      currency: 'PEN',
      source: data.source,
    })
  }
  trackPixelEvent('checkout_submitted', {
    valueCents: data.totalCents,
    items: data.courses,
    eventId: data.eventId,
  })
}
