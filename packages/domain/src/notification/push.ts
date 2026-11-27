import { EMAIL_CATALOG, EMAIL_CATALOG_KEYS, type EmittedEmailKey } from "./emailCatalog.js";

/*
 * Push notifications on the student's portal (OOC-51). A push is never a
 * message of its own: it is the e-mail the platform already writes to the
 * outbox, sent a second way to the devices the account turned it on for —
 * the same outbox row carries both, so one event is one e-mail and at most
 * one push per device, never two.
 */

/**
 * The e-mails that also go out as a push: the steps of the student's journey
 * (the catalog entries with a `stage`) the platform sends today. Left out:
 *
 * - `portal_credentials` — it opens the account, so no device of that
 *   account can be subscribed yet;
 * - everything without a stage — the account's security messages (a push
 *   announcing a password reset is one more channel a phisher can imitate),
 *   the complaints book (filed by anybody, account or not) and staff mail.
 */
const NOT_PUSHED = ["portal_credentials"] as const;

export type PushEmailKey = Exclude<
  {
    [K in EmittedEmailKey]: (typeof EMAIL_CATALOG)[K]["stage"] extends null ? never : K;
  }[EmittedEmailKey],
  (typeof NOT_PUSHED)[number]
>;

export const PUSH_EMAIL_KEYS = EMAIL_CATALOG_KEYS.filter((key): key is PushEmailKey => {
  const entry: { emitted: boolean; stage: string | null } = EMAIL_CATALOG[key];
  return entry.emitted && entry.stage !== null && !(NOT_PUSHED as readonly string[]).includes(key);
});

export function isPushEmailKey(key: string): key is PushEmailKey {
  return (PUSH_EMAIL_KEYS as string[]).includes(key);
}

/**
 * The push services a browser hands out subscriptions on. The API POSTs to
 * whatever endpoint a subscription names, so an endpoint is a URL the client
 * chose — accepted only on these hosts, or the subscription route would be a
 * way to make the API call any address (SSRF). A host is listed exactly, or
 * as a suffix starting with a dot (any subdomain of it).
 *
 * - Chrome, Edge on Android, Opera, Samsung Internet, Brave: Firebase.
 * - Firefox: Mozilla's autopush.
 * - Safari on macOS and iOS (16.4+, installed to the home screen): Apple.
 * - Edge on Windows: WNS.
 */
const PUSH_SERVICE_HOSTS = ["fcm.googleapis.com", ".push.services.mozilla.com", ".push.apple.com", ".notify.windows.com"];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "") return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((allowed) => (allowed.startsWith(".") ? host.endsWith(allowed) : host === allowed));
}

/** Devices one account keeps subscribed; subscribing another drops the oldest. */
export const MAX_PUSH_SUBSCRIPTIONS_PER_ACCOUNT = 10;

/**
 * A push about something that happened long ago is noise, not news: a row
 * still waiting after this long (push was off, the worker was down) is never
 * offered. The e-mail of the same row is unaffected.
 */
export const PUSH_MAX_AGE_HOURS = 24;
