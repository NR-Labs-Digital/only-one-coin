/*
 * The landing's doors into the checkout (OOC-117) — one copy, read by
 * `apps/landing` (which key each enroll button sends), `apps/api` (which keys
 * a course may carry) and `apps/app` (the backoffice picker, and the checkout
 * resolving `?course=<key>`), through the `@ooc/domain/landing-course-keys`
 * subpath.
 *
 * Imported raw by the Astro and Next.js builds, so it stays self-contained:
 * no dependency, no relative import.
 *
 * Why keys and not course ids: the landing is a static site, and a course id
 * is a UUID minted by whichever database the course was created in. A map of
 * ids baked into the landing pointed at nothing the day a course was recreated
 * in the backoffice, and never matched staging or a local seed — the checkout
 * opened empty and nobody noticed. A key is the landing's own vocabulary; the
 * backoffice says which course answers to it, in every environment.
 *
 * One key per landing page that sells a course (`courseSlugs` in
 * `apps/landing/src/i18n/ui.ts` — the landing's build refuses a page with no
 * key here), plus `english-kids`: the kids programme lives on the English
 * page but is a course of its own (docs/REGRAS-NEGOCIO.md §2).
 */
export const LANDING_COURSE_KEYS = [
  "english",
  "english-kids",
  "english-intermediate",
  "cambridge-b1",
  "cambridge-b2",
  "french",
  "french-advanced",
  "italian",
  "german",
  "portuguese",
  "mandarin-chinese",
  "korean",
  "japanese",
  "russian",
] as const;

export type LandingCourseKey = (typeof LANDING_COURSE_KEYS)[number];

export function isLandingCourseKey(value: unknown): value is LandingCourseKey {
  return typeof value === "string" && (LANDING_COURSE_KEYS as readonly string[]).includes(value);
}
