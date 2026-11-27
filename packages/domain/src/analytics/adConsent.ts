/*
 * Measurement vocabulary shared by the landing and the public checkout
 * (OOC-47) — read by `apps/landing` and `apps/app` through the
 * `@ooc/domain/analytics` subpath.
 *
 * Imported raw by the Astro and Next.js builds, so it stays self-contained:
 * no dependency, no relative import, no DOM. The two apps read and write the
 * cookie themselves; this file only says what it is called and what it holds.
 *
 * Two layers, two rules (decision of 27/11/2026 with Miguel, to be confirmed
 * with the owner — Ley 29733, and a large share of the audience is under 18):
 *
 * - PostHog, our own product analytics, loads for everybody: no cookie, the
 *   anonymous id lives in `sessionStorage` (gone when the tab closes), no
 *   person profile, no autocapture, nothing typed into a form.
 * - The paid-media pixels (Meta, TikTok) set third-party identifiers and
 *   report to the ad networks, so they load only after the visitor accepts the
 *   banner. The answer is this cookie, on the parent domain when one is
 *   configured, so the landing and the checkout (different subdomains) ask
 *   once between them.
 */

/** Name of the cookie that holds the visitor's answer to the pixel banner. */
export const AD_CONSENT_COOKIE = "ooc_ad_consent";

export type AdConsent = "granted" | "denied";

/**
 * How long an answer is kept before the banner asks again: 180 days.
 * Provisional — no rule fixes it; it is long enough not to nag a family that
 * comes back to enroll a second child, short enough to ask again next season.
 */
export const AD_CONSENT_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

/** The visitor's answer read off a `document.cookie` string, or null when
 * they have not answered (or the value is not one we write). */
export function readAdConsent(cookieString: string): AdConsent | null {
  for (const part of cookieString.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== AD_CONSENT_COOKIE) continue;
    const value = rest.join("=");
    return value === "granted" || value === "denied" ? value : null;
  }
  return null;
}

/**
 * The `document.cookie` assignment that stores an answer.
 *
 * `domain` is the parent domain both sites share (`.onlyonecoin.edu.pe`); it
 * comes from each app's environment, never from the code. Without it the
 * cookie is host-only and each site asks on its own — the right behaviour on a
 * preview URL, where the two apps have unrelated hosts. A value that is not a
 * bare domain is ignored rather than spliced into the cookie.
 */
export function adConsentCookie(
  value: AdConsent,
  options: { domain?: string | undefined; secure: boolean },
): string {
  const parts = [
    `${AD_CONSENT_COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${AD_CONSENT_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ];
  const domain = options.domain?.trim();
  if (domain && /^\.?[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain)) parts.push(`Domain=${domain}`);
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * The landing hands its PostHog anonymous id to the checkout in the URL
 * fragment (`#ph_id=<id>`), so a visit that starts on a course page and ends
 * on the receipt is one funnel and not two strangers. A fragment, not a query
 * parameter: it never reaches a server log, never mixes with the checkout's
 * prefill and attribution parameters, and the checkout drops it from the
 * address bar as soon as it is read.
 */
export const ANALYTICS_HANDOFF_PARAM = "ph_id";

/** PostHog anonymous ids are UUIDs; anything else in the fragment is ignored. */
export function isAnalyticsHandoffId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * The enrollment funnel as PostHog sees it, in order. One list, so the
 * landing and the checkout cannot drift apart and the funnel insight in
 * PostHog is built from these names (`docs/MEDICAO.md`).
 *
 * Properties carry no personal data: never a name, document, e-mail, phone
 * or receipt — only which page, which course key, which step, how many
 * courses and the expected total.
 */
export const FUNNEL_EVENTS = {
  /** Landing: an enroll button was clicked (`content` = which piece). */
  ctaClicked: "enrollment_cta_clicked",
  /** Checkout: the wizard opened. */
  checkoutStarted: "checkout_started",
  /** Checkout: a step came on screen (`step` = course | student | payment | review). */
  stepViewed: "checkout_step_viewed",
  /** Checkout: the receipt was sent and the API accepted the enrollment. */
  submitted: "checkout_submitted",
} as const;
