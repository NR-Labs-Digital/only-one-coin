/* eslint-disable i18next/no-literal-string --
   whole file is technical identifiers (script URLs, pixel method and event
   names) that are never rendered to a user — none of it is UI text. */

/**
 * The paid-media pixels (OOC-47): Meta and TikTok, loaded only after the
 * visitor accepts the banner (`@ooc/domain/analytics`).
 *
 * The vendors' copy-paste snippets are inline scripts, which the landing's CSP
 * (`script-src 'self'`, `vercel.json`) refuses. This is the same stub written
 * as a module of our own bundle: it queues calls until the vendor script
 * arrives, then the vendor drains the queue. Only the script hosts are in the
 * CSP, never 'unsafe-inline'.
 *
 * Twin of `apps/app/src/lib/analytics/pixels.ts` (the public checkout). The
 * two apps share no browser code package, so the copy is deliberate — change
 * both together.
 *
 * Never personal data: Meta's automatic configuration (which reads buttons and
 * form fields) is turned off here, and advanced matching (e-mail, phone) is
 * never sent. The "automatic advanced matching" toggles in Meta's and
 * TikTok's Events Manager must stay off too (`docs/MEDICAO.md`).
 */

const META_SCRIPT = "https://connect.facebook.net/en_US/fbevents.js";
const TIKTOK_SCRIPT = "https://analytics.tiktok.com/i18n/pixel/events.js";

/** Pixel ids are digits (Meta) or letters and digits (TikTok); anything else
 * in the environment is a mistake, not something to splice into a URL. */
const PIXEL_ID = /^[A-Z0-9]{6,40}$/i;

type Queue = unknown[][];
type MetaFn = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: Queue;
  push: unknown;
  loaded: boolean;
  version: string;
};
type TikTokQueue = unknown[] & Record<string, unknown>;

declare global {
  interface Window {
    fbq?: MetaFn;
    _fbq?: MetaFn;
    ttq?: TikTokQueue;
    TiktokAnalyticsObject?: string;
  }
}

function addScript(src: string): void {
  const script = document.createElement("script");
  script.async = true;
  script.src = src;
  document.head.appendChild(script);
}

export function validPixelId(value: string | undefined): string | null {
  const id = value?.trim();
  return id && PIXEL_ID.test(id) ? id : null;
}

function loadMeta(pixelId: string): void {
  if (window.fbq) return;
  const fbq = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue.push(args);
  } as MetaFn;
  fbq.queue = [];
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  window.fbq = fbq;
  window._fbq = fbq;
  addScript(META_SCRIPT);
  // Before `init`: no reading of buttons and page metadata by Meta.
  fbq("set", "autoConfig", false, pixelId);
  fbq("init", pixelId);
  fbq("track", "PageView");
}

// The method list of TikTok's own snippet: each is queued until events.js loads.
const TIKTOK_METHODS = [
  "page", "track", "identify", "instances", "debug", "on", "off", "once", "ready",
  "alias", "group", "enableCookie", "disableCookie", "holdConsent", "revokeConsent", "grantConsent",
];

function loadTikTok(pixelId: string): void {
  if (window.ttq) return;
  const ttq = [] as unknown as TikTokQueue;
  const defer = (target: TikTokQueue, method: string) => {
    target[method] = (...args: unknown[]) => {
      target.push([method, ...args]);
    };
  };
  for (const method of TIKTOK_METHODS) defer(ttq, method);
  ttq.instance = (id: string) => {
    const instances = (ttq._i as Record<string, TikTokQueue>) ?? {};
    const instance = instances[id] ?? ([] as unknown as TikTokQueue);
    for (const method of TIKTOK_METHODS) defer(instance, method);
    return instance;
  };
  ttq._i = { [pixelId]: Object.assign([], { _u: TIKTOK_SCRIPT }) };
  ttq._t = { [pixelId]: Date.now() };
  ttq._o = { [pixelId]: {} };
  window.TiktokAnalyticsObject = "ttq";
  window.ttq = ttq;
  addScript(`${TIKTOK_SCRIPT}?sdkid=${encodeURIComponent(pixelId)}&lib=ttq`);
  (ttq.page as () => void)();
}

export interface PixelIds {
  meta: string | null;
  tiktok: string | null;
}

/** Loads every configured pixel and counts this page view. Idempotent. */
export function loadPixels(ids: PixelIds): void {
  if (ids.meta) loadMeta(ids.meta);
  if (ids.tiktok) loadTikTok(ids.tiktok);
}
