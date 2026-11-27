/* eslint-disable i18next/no-literal-string --
   whole file is technical identifiers (env names, DOM selectors, event and
   property names, URL paths) that are never rendered to a user — the banner's
   text lives in `src/i18n/ui.ts` and is rendered by `ConsentBanner.astro`. */
import posthog from "posthog-js/dist/module.slim.no-external";
import {
  ANALYTICS_HANDOFF_PARAM,
  FUNNEL_EVENTS,
  adConsentCookie,
  readAdConsent,
  type AdConsent,
} from "@ooc/domain/analytics";
import { loadPixels, validPixelId } from "./pixels";

/**
 * Measurement on the landing (OOC-47), loaded on every page by `Base.astro`.
 *
 * - PostHog for everybody, with no cookie (`@ooc/domain/analytics` says why):
 *   page views plus one event, the enroll button. Sent through our own
 *   domain (`/ooc-ev`, a rewrite in `vercel.json`), so the CSP keeps
 *   `connect-src 'self'` for it.
 * - Meta and TikTok only with the banner accepted.
 *
 * Every id comes from the build environment (`PUBLIC_*`, inlined by Astro).
 * Unset, that piece simply does not load — local builds, previews and a
 * production without ids stay silent.
 */

const POSTHOG_KEY = import.meta.env.PUBLIC_POSTHOG_KEY as string | undefined;
const COOKIE_DOMAIN = import.meta.env.PUBLIC_CONSENT_COOKIE_DOMAIN as string | undefined;
const pixelIds = {
  meta: validPixelId(import.meta.env.PUBLIC_META_PIXEL_ID as string | undefined),
  tiktok: validPixelId(import.meta.env.PUBLIC_TIKTOK_PIXEL_ID as string | undefined),
};
const hasPixels = Boolean(pixelIds.meta || pixelIds.tiktok);

/** The proxy path in `vercel.json` (PostHog advises against `/ingest` and
 * the like, which blockers list by name). */
const POSTHOG_PROXY = "/ooc-ev";
const POSTHOG_UI = "https://eu.posthog.com";

/** The app paths the landing hands over to `apps/app` (`middleware.ts`). */
const ENROLLMENT_PATH = /^(?:\/(?:en|pt))?\/enrollment(?:\/|$)/;

let posthogReady = false;

function startPostHog(): void {
  const key = POSTHOG_KEY?.trim();
  if (!key) return;
  posthog.init(key, {
    api_host: POSTHOG_PROXY,
    ui_host: POSTHOG_UI,
    // No cookie and no localStorage: the anonymous id lives in this tab only.
    persistence: "sessionStorage",
    // Anonymous events only — we never identify anybody here.
    person_profiles: "identified_only",
    // Explicit events, never clicks and text read off the page.
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
    // Nothing fetched from PostHog's CDN: everything is in our bundle.
    disable_external_dependency_loading: true,
    // Ad click ids (fbclid, gclid…) are masked in the URLs PostHog stores.
    mask_personal_data_properties: true,
  });
  posthogReady = true;
}

/**
 * The enroll button: counted, and the anonymous id rides along in the URL
 * fragment so the checkout (another subdomain) continues the same funnel.
 * One listener for the whole page — the buttons are plain links rendered
 * by a dozen components.
 */
function trackEnrollClicks(): void {
  document.addEventListener("click", (event) => {
    if (!posthogReady) return;
    const link = (event.target as Element | null)?.closest?.("a[href]");
    if (!(link instanceof HTMLAnchorElement)) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin || !ENROLLMENT_PATH.test(url.pathname)) return;

    posthog.capture(
      FUNNEL_EVENTS.ctaClicked,
      {
        content: url.searchParams.get("utm_content"),
        course: url.searchParams.get("course"),
      },
      // The page is about to unload: hand the event to the browser.
      { transport: "sendBeacon" },
    );
    url.hash = `${ANALYTICS_HANDOFF_PARAM}=${encodeURIComponent(posthog.get_distinct_id())}`;
    link.href = url.toString();
  });
}

function saveConsent(value: AdConsent): void {
  document.cookie = adConsentCookie(value, {
    domain: COOKIE_DOMAIN,
    secure: window.location.protocol === "https:",
  });
}

/**
 * The banner (`ConsentBanner.astro`, hidden in the HTML): shown while the
 * visitor has not answered, and again from the footer's "Cookies" button.
 * Withdrawing a yes reloads the page — a loaded pixel cannot be unloaded, and
 * after the reload it is simply not loaded again.
 */
function wireConsent(): void {
  const banner = document.querySelector<HTMLElement>("[data-consent-banner]");
  if (!hasPixels || !banner) return;

  const current = readAdConsent(document.cookie);
  if (current === "granted") loadPixels(pixelIds);
  if (current === null) banner.hidden = false;

  for (const opener of document.querySelectorAll<HTMLElement>("[data-consent-open]")) {
    opener.hidden = false;
    opener.addEventListener("click", () => {
      banner.hidden = false;
      banner.querySelector<HTMLButtonElement>("[data-consent-accept]")?.focus();
    });
  }

  banner.querySelector("[data-consent-accept]")?.addEventListener("click", () => {
    saveConsent("granted");
    banner.hidden = true;
    loadPixels(pixelIds);
  });
  banner.querySelector("[data-consent-reject]")?.addEventListener("click", () => {
    const wasGranted = readAdConsent(document.cookie) === "granted";
    saveConsent("denied");
    banner.hidden = true;
    if (wasGranted) window.location.reload();
  });
}

startPostHog();
trackEnrollClicks();
wireConsent();
