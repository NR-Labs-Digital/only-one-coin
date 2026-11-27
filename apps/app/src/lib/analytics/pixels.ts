/**
 * The paid-media pixels on the public checkout (OOC-47): Meta and TikTok,
 * loaded only after the visitor accepts the banner (`@ooc/domain/analytics`).
 *
 * The vendors' copy-paste snippets are inline scripts, which the CSP
 * (`middleware.ts`, nonce + 'strict-dynamic') refuses. This is the same stub
 * written as a module of our own bundle — which 'strict-dynamic' trusts to
 * insert the vendor script — queueing calls until that script arrives.
 *
 * Twin of `apps/landing/src/analytics/pixels.ts`, plus the conversion events
 * the landing has no use for. The two apps share no browser code package, so
 * the copy is deliberate — change both together.
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

/**
 * The funnel's two moments, in each network's standard vocabulary — the
 * names their campaign optimisation understands. Does nothing for a pixel
 * that was not loaded (no consent, or no id).
 *
 * `eventId` lets each network drop a duplicate if the same submission is
 * reported twice (a retry, or a future server-side event).
 */
export function trackPixelEvent(
  moment: "checkout_started" | "checkout_submitted",
  data: { valueCents?: number; items?: number; eventId?: string } = {},
): void {
  const value = data.valueCents === undefined ? undefined : data.valueCents / 100;
  const props = value === undefined ? {} : { value, currency: "PEN", num_items: data.items };
  if (window.fbq) {
    const name = moment === "checkout_started" ? "InitiateCheckout" : "Purchase";
    window.fbq("track", name, props, data.eventId ? { eventID: data.eventId } : undefined);
  }
  if (window.ttq) {
    const name = moment === "checkout_started" ? "InitiateCheckout" : "CompletePayment";
    (window.ttq.track as (...args: unknown[]) => void)(
      name,
      value === undefined ? {} : { value, currency: "PEN", quantity: data.items },
      data.eventId ? { event_id: data.eventId } : undefined,
    );
  }
}
